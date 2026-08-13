'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const master = require('./MasterInstantlyRevenueReconciliationService');
const planService = require('./InstantlyRevenueDeploymentPlanService');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_PRIORITY_DEDUP_SENDER_CAPACITY_GATE_LATEST.json');

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }

async function readCampaignLeadEmails(connector, campaignId) {
  const rows = await master.readAllCampaignLeads(connector, campaignId);
  const out = new Set();
  for (const row of rows) {
    const e = normalizeEmail(row?.email || row?.contact || row?.lead_email);
    if (e) out.add(e);
  }
  return out;
}

async function readAllAccounts(connector) {
  const rows = [];
  const seen = new Set();
  let startingAfter;
  for (let page = 0; page < 100; page += 1) {
    const payload = { limit: 100 };
    if (startingAfter) payload.starting_after = startingAfter;
    const r = await connector.execute({ action: 'listAccounts', payload });
    const env = r?.accounts || r?.result || {};
    const items = unwrapItems(env);
    for (const x of items) {
      const email = normalizeEmail(x?.email || x?.account || x?.address);
      const id = String(x?.id || email || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(x);
    }
    const next = env?.next_starting_after || env?.nextStartingAfter || null;
    if (!next || items.length === 0 || next === startingAfter) break;
    startingAfter = next;
  }
  return rows;
}

function summarizeVital(value) {
  if (!value || typeof value !== 'object') return { healthy: null, status: 'UNKNOWN' };
  const status = String(value?.status || value?.state || value?.health || value?.result || '').toUpperCase();
  const healthy = value?.healthy === true || value?.ok === true || ['OK','HEALTHY','PASS','PASSED','SUCCESS'].includes(status);
  const unhealthy = value?.healthy === false || ['BAD','UNHEALTHY','FAIL','FAILED','ERROR','DISCONNECTED'].includes(status);
  return { healthy: unhealthy ? false : healthy ? true : null, status: status || 'UNKNOWN' };
}

async function run() {
  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const plan = await planService.run();
  const snapshot = await master.run();
  const rowById = new Map(snapshot.campaigns.map(x => [x.campaignId, x]));

  const suppressionRows = snapshot.campaigns.filter(x => x.family === 'SUPPRESSION');
  const suppressed = new Set();
  for (const row of suppressionRows) {
    const set = await readCampaignLeadEmails(connector, row.campaignId);
    for (const e of set) suppressed.add(e);
  }

  const activeAcquisitionRows = snapshot.campaigns.filter(x => x.statusLabel === 'ACTIVE' && !['SUPPRESSION','PIPELINE','MEETING_PIPELINE','NURTURE','FOLLOW_UP'].includes(x.family));
  const activeEmails = new Set();
  for (const row of activeAcquisitionRows) {
    const set = await readCampaignLeadEmails(connector, row.campaignId);
    for (const e of set) activeEmails.add(e);
  }

  const claimed = new Set();
  const candidatePlans = [];
  const candidates = [...plan.activationCandidates].sort((a,b) => a.priority - b.priority || b.leadCount - a.leadCount || a.campaignName.localeCompare(b.campaignName));

  for (const c of candidates) {
    const emails = await readCampaignLeadEmails(connector, c.campaignId);
    let blockedSuppression = 0;
    let blockedActive = 0;
    let blockedHigherPriorityCandidate = 0;
    const eligible = [];
    for (const e of emails) {
      if (suppressed.has(e)) { blockedSuppression += 1; continue; }
      if (activeEmails.has(e)) { blockedActive += 1; continue; }
      if (claimed.has(e)) { blockedHigherPriorityCandidate += 1; continue; }
      eligible.push(e);
      claimed.add(e);
    }
    const row = rowById.get(c.campaignId) || {};
    candidatePlans.push({
      priority: c.priority,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      family: c.family,
      observedLeads: emails.size,
      blockedSuppression,
      blockedActiveAcquisition: blockedActive,
      blockedHigherPriorityCandidate,
      eligibleUniqueContacts: eligible.length,
      currentSenderEmails: row.senderEmails || [],
      senderCount: row.senderCount || 0,
      sequenceStepCount: row.sequenceStepCount || 0,
      schedulePresent: Boolean(row.schedulePresent),
      dailyLimit: Number(row.dailyLimit || 0),
      readyForSenderHealthGate: eligible.length > 0 && (row.senderCount || 0) > 0 && (row.sequenceStepCount || 0) > 0
    });
  }

  const accounts = await readAllAccounts(connector);
  const accountByEmail = new Map();
  for (const a of accounts) {
    const e = normalizeEmail(a?.email || a?.account || a?.address);
    if (e) accountByEmail.set(e, a);
  }

  const senderEmails = [...new Set(candidatePlans.flatMap(x => x.currentSenderEmails.map(normalizeEmail)).filter(Boolean))];
  let vitalsEnvelope = null;
  let vitalsError = null;
  if (senderEmails.length) {
    try {
      const vr = await connector.execute({ action: 'testAccountVitals', payload: { emails: senderEmails } });
      vitalsEnvelope = vr?.vitals || vr?.result || vr || null;
    } catch (e) {
      vitalsError = e.message;
    }
  }

  const vitalItems = unwrapItems(vitalsEnvelope);
  const vitalByEmail = new Map();
  for (const v of vitalItems) {
    const e = normalizeEmail(v?.email || v?.account || v?.address);
    if (e) vitalByEmail.set(e, v);
  }

  const senders = senderEmails.map(email => {
    const account = accountByEmail.get(email) || null;
    const vital = vitalByEmail.get(email) || null;
    const summary = summarizeVital(vital);
    return {
      email,
      accountPresent: Boolean(account),
      accountStatus: account?.status ?? account?.state ?? null,
      warmupStatus: account?.warmup_status ?? account?.warmupStatus ?? null,
      dailyLimit: Number(account?.daily_limit || account?.dailyLimit || account?.send_limit || 0),
      vitalObserved: Boolean(vital),
      vitalHealth: summary.healthy,
      vitalStatus: summary.status
    };
  });

  const senderByEmail = new Map(senders.map(x => [x.email, x]));
  for (const c of candidatePlans) {
    const assigned = c.currentSenderEmails.map(normalizeEmail).map(e => senderByEmail.get(e)).filter(Boolean);
    const unhealthy = assigned.filter(x => x.vitalHealth === false).length;
    const unknown = assigned.filter(x => x.vitalHealth == null).length;
    c.senderHealth = {
      assigned: assigned.length,
      healthy: assigned.filter(x => x.vitalHealth === true).length,
      unhealthy,
      unknown,
      vitalsError
    };
    c.readyForMessageAndActivationGate = c.readyForSenderHealthGate && unhealthy === 0 && assigned.length > 0;
  }

  const result = {
    ok: true,
    gate: 'P1.5C_INSTANTLY_REVENUE_PRIORITY_DEDUP_SENDER_CAPACITY_GATE',
    generatedAt: new Date().toISOString(),
    totals: {
      activationCandidates: candidatePlans.length,
      suppressedContacts: suppressed.size,
      activeAcquisitionContacts: activeEmails.size,
      uniqueCandidateContactsAfterPriorityDedup: claimed.size,
      eligibleContacts: candidatePlans.reduce((n,x) => n + x.eligibleUniqueContacts, 0),
      blockedSuppression: candidatePlans.reduce((n,x) => n + x.blockedSuppression, 0),
      blockedActiveAcquisition: candidatePlans.reduce((n,x) => n + x.blockedActiveAcquisition, 0),
      blockedCandidateOverlap: candidatePlans.reduce((n,x) => n + x.blockedHigherPriorityCandidate, 0),
      senderAccountsObserved: accounts.length,
      candidateSenderEmails: senderEmails.length,
      campaignsReadyForMessageAndActivationGate: candidatePlans.filter(x => x.readyForMessageAndActivationGate).length
    },
    priorityPolicy: {
      order: ['EXPIRATION','GSA','VA','SAM','CERTIFICATION','SBS','STATE_SLED'],
      activeAcquisitionAlwaysWinsOverPausedCandidate: true,
      suppressionAlwaysWins: true,
      candidateOverlapAssignedToHighestPriorityCampaign: true
    },
    candidatePlans,
    senders,
    vitalsRawObserved: Boolean(vitalsEnvelope),
    vitalsError,
    safety: {
      readOnly: true,
      activateCampaigns: false,
      pauseCampaigns: false,
      updateCampaigns: false,
      moveLeads: false,
      uploadLeads: false,
      deleteLeads: false,
      deleteCampaigns: false,
      sendReplies: false
    }
  };

  fs.mkdirSync(OUTPUT_DIR, {recursive:true});
  result.outputFile = OUTPUT_FILE;
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run };
