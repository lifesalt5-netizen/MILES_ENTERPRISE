'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const master = require('./MasterInstantlyRevenueReconciliationService');

const ROOT = process.cwd();
const INPUT_C = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_PRIORITY_DEDUP_SENDER_CAPACITY_GATE_LATEST.json');
const INPUT_D = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_MESSAGE_ACTIVATION_GATE_LATEST.json');
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_DEDUP_CONFIG_REPAIR_LATEST.json');
const AUTH_TOKEN = 'AUTHORIZE_P1_5E_DEDUP_CONFIG_REPAIR';
const BASE_URL = process.env.INSTANTLY_BASE_URL || 'https://api.instantly.ai/api/v2';

function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function loadJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Required artifact not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function schedule() {
  return {
    schedules: [{
      name: 'P2GC Weekdays Eastern',
      timing: { from: '09:00', to: '17:00' },
      days: { '0': true, '1': true, '2': true, '3': true, '4': true, '5': false, '6': false },
      timezone: 'America/Detroit'
    }]
  };
}
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
    const statusCode = Number(e?.response?.status || 0);
    const detail = e?.response?.data || e?.message || e;
    const message = String(detail?.message || detail || '');
    if (statusCode === 409 && /move-leads job in progress/i.test(message)) return { ok: false, busy: true, statusCode, detail };
    throw new Error(`Instantly API mutation failed ${method} ${endpoint}: ${JSON.stringify(detail)}`);
  }
}
async function readEmails(connector, campaignId) {
  const rows = await master.readAllCampaignLeads(connector, campaignId);
  const set = new Set();
  for (const row of rows) {
    const e = normalizeEmail(row?.email || row?.contact || row?.lead_email);
    if (e) set.add(e);
  }
  return set;
}

async function run(options = {}) {
  const authorization = String(options.authorization || process.env.MILES_P1_5E_AUTH || '').trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_P1_5E_LIVE || '').toLowerCase() === 'true';
  if (authorization !== AUTH_TOKEN) throw new Error('P1.5E authorization token missing or incorrect.');
  if (!executeLive) throw new Error('P1.5E live flag is not enabled.');

  const c = loadJson(INPUT_C);
  const d = loadJson(INPUT_D);
  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const snapshot = await master.run();
  const rowById = new Map(snapshot.campaigns.map(x => [x.campaignId, x]));
  const candidatePlans = Array.isArray(c.candidatePlans) ? [...c.candidatePlans] : [];
  if (!candidatePlans.length) throw new Error('No P1.5C candidate plans found; refusing mutation.');

  candidatePlans.sort((a,b) => Number(a.priority||999)-Number(b.priority||999) || Number(b.observedLeads||0)-Number(a.observedLeads||0) || String(a.campaignName).localeCompare(String(b.campaignName)));

  const activeRows = snapshot.campaigns.filter(x => x.statusLabel === 'ACTIVE' && !['SUPPRESSION','PIPELINE','MEETING_PIPELINE','NURTURE','FOLLOW_UP'].includes(x.family));
  const ownerByEmail = new Map();
  for (const row of activeRows) {
    const emails = await readEmails(connector, row.campaignId);
    for (const e of emails) if (!ownerByEmail.has(e)) ownerByEmail.set(e, { campaignId: row.campaignId, campaignName: row.campaignName, ownerType: 'ACTIVE_ACQUISITION' });
  }

  const candidateEmails = new Map();
  for (const plan of candidatePlans) candidateEmails.set(plan.campaignId, await readEmails(connector, plan.campaignId));

  for (const plan of candidatePlans) {
    for (const e of candidateEmails.get(plan.campaignId) || []) {
      if (!ownerByEmail.has(e)) ownerByEmail.set(e, { campaignId: plan.campaignId, campaignName: plan.campaignName, ownerType: 'PRIORITY_CANDIDATE' });
    }
  }

  const dedupGroups = new Map();
  let duplicateMembershipsToRemove = 0;
  for (const plan of candidatePlans) {
    const sourceId = plan.campaignId;
    for (const e of candidateEmails.get(sourceId) || []) {
      const owner = ownerByEmail.get(e);
      if (!owner || owner.campaignId === sourceId) continue;
      duplicateMembershipsToRemove += 1;
      const key = `${sourceId}::${owner.campaignId}`;
      if (!dedupGroups.has(key)) dedupGroups.set(key, { sourceCampaignId: sourceId, sourceCampaignName: plan.campaignName, targetCampaignId: owner.campaignId, targetCampaignName: owner.campaignName, contacts: [] });
      dedupGroups.get(key).contacts.push(e);
    }
  }

  const dedupJobs = [];
  const busyGroups = [];
  for (const group of dedupGroups.values()) {
    const contacts = [...new Set(group.contacts)];
    if (!contacts.length) continue;

    // Critical P1.5E fix:
    // These contacts are intentionally already members of the designated owner campaign.
    // Enabling duplicate checks causes Instantly to classify every requested contact as a
    // duplicate and report a successful background job with moved_leads=0. We therefore
    // disable duplicate checks here and move the source membership to the already-selected
    // owner campaign. copy_leads=false ensures the lower-priority source membership is removed.
    const payload = {
      campaign: group.sourceCampaignId,
      contacts,
      to_campaign_id: group.targetCampaignId,
      copy_leads: false,
      check_duplicates: false,
      check_duplicates_in_campaigns: false,
      skip_leads_in_verification: true,
      reset_interest_status: false,
      limit: contacts.length
    };

    const r = await api('POST', '/leads/move', payload);
    if (r.busy) {
      busyGroups.push({ ...group, contactsDeferred: contacts.length, contacts: undefined, reason: 'MOVE_JOB_IN_PROGRESS' });
      continue;
    }
    if (!r.data?.id) throw new Error(`No background job id returned for dedup ${group.sourceCampaignName} -> ${group.targetCampaignName}.`);
    dedupJobs.push({
      ...group,
      contactsRequested: contacts.length,
      contacts: undefined,
      backgroundJobId: r.data.id,
      status: r.data.status || null,
      type: r.data.type || null,
      duplicateChecksDisabledForOwnerPreservingMove: true
    });
  }

  const repairs = [];
  for (const candidate of (d.candidates || [])) {
    const current = rowById.get(candidate.campaignId) || {};
    const updates = {};
    if (!candidate.schedulePresent) updates.campaign_schedule = schedule();
    if (Number(candidate.dailyLimit || current.dailyLimit || 0) <= 0) {
      const senderCount = Math.max(1, Array.isArray(candidate.senderEmails) ? candidate.senderEmails.length : Number(current.senderCount || 1));
      updates.daily_limit = Math.min(125, senderCount * 25);
      updates.daily_max_leads = updates.daily_limit;
    }
    if (!Object.keys(updates).length) continue;
    const r = await api('PATCH', `/campaigns/${encodeURIComponent(candidate.campaignId)}`, updates);
    repairs.push({ campaignId: candidate.campaignId, campaignName: candidate.campaignName, updates, responseObserved: Boolean(r.data) });
  }

  const result = {
    ok: true,
    gate: 'P1.5E_INSTANTLY_REVENUE_DEDUP_ENFORCEMENT_CONFIG_REPAIR',
    version: '1.1-owner-preserving-cross-campaign-move',
    generatedAt: new Date().toISOString(),
    duplicateMembershipsToRemove,
    dedupJobsSubmitted: dedupJobs.length,
    dedupContactsRequested: dedupJobs.reduce((n,x) => n + Number(x.contactsRequested || 0), 0),
    dedupBusyGroups: busyGroups.length,
    dedupContactsDeferredBusy: busyGroups.reduce((n,x) => n + Number(x.contactsDeferred || 0), 0),
    configRepairsExecuted: repairs.length,
    dedupJobs,
    busyGroups,
    repairs,
    nextGate: 'P1.5F_POST_REPAIR_RECONCILIATION_AND_FIRST_BATCH_ACTIVATION',
    safety: {
      exactPriorityDedupOnly: true,
      duplicateSourceMembershipRemoved: true,
      ownerCampaignPreserved: true,
      duplicateChecksDisabledOnlyBecauseOwnerAlreadySelected: true,
      deleteLeads: false,
      deleteCampaigns: false,
      activateCampaigns: false,
      sendReplies: false,
      maximumDailyPerInbox: 25
    },
    outputFile: OUTPUT_FILE
  };

  fs.mkdirSync(OUTPUT_DIR, {recursive:true});
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run };
