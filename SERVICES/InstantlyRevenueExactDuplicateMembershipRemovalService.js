'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const master = require('./MasterInstantlyRevenueReconciliationService');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_EXACT_DUPLICATE_MEMBERSHIP_REMOVAL_LATEST.json');
const AUTH_TOKEN = 'AUTHORIZE_P1_5E2_EXACT_DUPLICATE_MEMBERSHIP_REMOVAL';
const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function authHeaders() {
  const apiKey = process.env.INSTANTLY_API_KEY || '';
  if (!apiKey) throw new Error('INSTANTLY_API_KEY is not configured.');
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}
async function api(method, endpoint, body) {
  try {
    const r = await axios({ method, url: `${BASE_URL}${endpoint}`, headers: authHeaders(), data: body, timeout: 30000, validateStatus: s => s >= 200 && s < 300 });
    return { ok: true, data: r.data };
  } catch (e) {
    const detail = e?.response?.data || e?.message || e;
    throw new Error(`Instantly API mutation failed ${method} ${endpoint}: ${JSON.stringify(detail)}`);
  }
}

function leadEmail(row) { return normalizeEmail(row?.email || row?.contact || row?.lead_email); }
function leadId(row) { return String(row?.id || row?.lead_id || '').trim(); }

async function readCampaignLeadObjects(connector, campaignId) {
  const rows = await master.readAllCampaignLeads(connector, campaignId);
  return rows.map(row => ({
    id: leadId(row),
    email: leadEmail(row),
    campaign: String(row?.campaign || campaignId || '').trim(),
    raw: row
  })).filter(x => x.id && x.email);
}

async function run(options = {}) {
  const authorization = String(options.authorization || process.env.MILES_P1_5E2_AUTH || '').trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_P1_5E2_LIVE || '').toLowerCase() === 'true';
  if (authorization !== AUTH_TOKEN) throw new Error('P1.5E2 authorization token missing or incorrect.');
  if (!executeLive) throw new Error('P1.5E2 live flag is not enabled.');

  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const snapshot = await master.run();
  const candidateIds = new Set(snapshot.campaigns.filter(x => x.statusLabel !== 'ACTIVE' && !['SUPPRESSION','PIPELINE','MEETING_PIPELINE','NURTURE','FOLLOW_UP'].includes(x.family)).map(x => x.campaignId));
  const activeRows = snapshot.campaigns.filter(x => x.statusLabel === 'ACTIVE' && !['SUPPRESSION','PIPELINE','MEETING_PIPELINE','NURTURE','FOLLOW_UP'].includes(x.family));

  const planFile = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_PRIORITY_DEDUP_SENDER_CAPACITY_GATE_LATEST.json');
  if (!fs.existsSync(planFile)) throw new Error(`Required P1.5C artifact not found: ${planFile}`);
  const planArtifact = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const plans = Array.isArray(planArtifact.candidatePlans) ? [...planArtifact.candidatePlans] : [];
  if (!plans.length) throw new Error('No P1.5C candidate plans found; refusing deletion.');
  plans.sort((a,b) => Number(a.priority||999)-Number(b.priority||999) || Number(b.observedLeads||0)-Number(a.observedLeads||0) || String(a.campaignName).localeCompare(String(b.campaignName)));

  const leadsByCampaign = new Map();
  for (const row of activeRows) leadsByCampaign.set(row.campaignId, await readCampaignLeadObjects(connector, row.campaignId));
  for (const plan of plans) if (!leadsByCampaign.has(plan.campaignId)) leadsByCampaign.set(plan.campaignId, await readCampaignLeadObjects(connector, plan.campaignId));

  const ownerByEmail = new Map();
  for (const row of activeRows) {
    for (const lead of leadsByCampaign.get(row.campaignId) || []) {
      if (!ownerByEmail.has(lead.email)) ownerByEmail.set(lead.email, { campaignId: row.campaignId, campaignName: row.campaignName, ownerType: 'ACTIVE_ACQUISITION', leadIds: [] });
      const owner = ownerByEmail.get(lead.email);
      if (owner.campaignId === row.campaignId) owner.leadIds.push(lead.id);
    }
  }
  for (const plan of plans) {
    for (const lead of leadsByCampaign.get(plan.campaignId) || []) {
      if (!ownerByEmail.has(lead.email)) ownerByEmail.set(lead.email, { campaignId: plan.campaignId, campaignName: plan.campaignName, ownerType: 'PRIORITY_CANDIDATE', leadIds: [] });
      const owner = ownerByEmail.get(lead.email);
      if (owner.campaignId === plan.campaignId) owner.leadIds.push(lead.id);
    }
  }

  const deletionPlan = [];
  const refused = [];
  for (const plan of plans) {
    const sourceLeads = leadsByCampaign.get(plan.campaignId) || [];
    for (const sourceLead of sourceLeads) {
      const owner = ownerByEmail.get(sourceLead.email);
      if (!owner || owner.campaignId === plan.campaignId) continue;
      const ownerObjects = leadsByCampaign.get(owner.campaignId) || [];
      const surviving = ownerObjects.filter(x => x.email === sourceLead.email && x.id && x.id !== sourceLead.id);
      if (!surviving.length) {
        refused.push({ email: sourceLead.email, sourceCampaignId: plan.campaignId, sourceLeadId: sourceLead.id, intendedOwnerCampaignId: owner.campaignId, reason: 'NO_DISTINCT_SURVIVING_OWNER_LEAD_OBJECT' });
        continue;
      }
      deletionPlan.push({
        email: sourceLead.email,
        sourceCampaignId: plan.campaignId,
        sourceCampaignName: plan.campaignName,
        sourceLeadId: sourceLead.id,
        ownerCampaignId: owner.campaignId,
        ownerCampaignName: owner.campaignName,
        ownerType: owner.ownerType,
        survivingOwnerLeadIds: surviving.map(x => x.id)
      });
    }
  }

  const uniqueByLeadId = new Map();
  for (const item of deletionPlan) if (!uniqueByLeadId.has(item.sourceLeadId)) uniqueByLeadId.set(item.sourceLeadId, item);
  const exactPlan = [...uniqueByLeadId.values()];

  const deleted = [];
  const failed = [];
  for (const item of exactPlan) {
    try {
      await api('DELETE', `/leads/${encodeURIComponent(item.sourceLeadId)}`);
      deleted.push(item);
    } catch (e) {
      failed.push({ ...item, error: e.message });
    }
  }

  // Post-delete verification: source membership absent, owner membership still present.
  const affectedCampaignIds = new Set();
  for (const item of deleted) { affectedCampaignIds.add(item.sourceCampaignId); affectedCampaignIds.add(item.ownerCampaignId); }
  const postLeadsByCampaign = new Map();
  for (const id of affectedCampaignIds) postLeadsByCampaign.set(id, await readCampaignLeadObjects(connector, id));

  const verification = deleted.map(item => {
    const sourceStill = (postLeadsByCampaign.get(item.sourceCampaignId) || []).some(x => x.email === item.email && x.id === item.sourceLeadId);
    const ownerStill = (postLeadsByCampaign.get(item.ownerCampaignId) || []).some(x => x.email === item.email);
    return { ...item, sourceMembershipRemoved: !sourceStill, ownerMembershipPreserved: ownerStill, verified: !sourceStill && ownerStill };
  });

  const verificationFailures = verification.filter(x => !x.verified);
  const result = {
    ok: failed.length === 0 && verificationFailures.length === 0 && refused.length === 0,
    gate: 'P1.5E2_EXACT_DUPLICATE_MEMBERSHIP_REMOVAL',
    version: '1.0-delete-source-lead-object-only-after-surviving-owner-proof',
    generatedAt: new Date().toISOString(),
    exactDuplicateMembershipsPlanned: exactPlan.length,
    refusedUnsafe: refused.length,
    deletedSourceLeadObjects: deleted.length,
    deletionFailures: failed.length,
    verificationFailures: verificationFailures.length,
    refused,
    failed,
    verification,
    nextGate: verificationFailures.length || failed.length || refused.length ? 'P1.5E2_REVIEW_FAILURES' : 'P1.5F_POST_REPAIR_RECONCILIATION_AND_FIRST_BATCH_ACTIVATION',
    safety: {
      deleteOnlySourceLeadObject: true,
      requireDistinctSurvivingOwnerLeadObject: true,
      preserveOwnerCampaignMembership: true,
      deleteCampaigns: false,
      activateCampaigns: false,
      sendReplies: false,
      candidateCampaignScopeOnly: true,
      officialInstantlyDeleteLeadEndpoint: 'DELETE /api/v2/leads/{id}'
    },
    outputFile: OUTPUT_FILE
  };

  fs.mkdirSync(OUTPUT_DIR, {recursive:true});
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run };
