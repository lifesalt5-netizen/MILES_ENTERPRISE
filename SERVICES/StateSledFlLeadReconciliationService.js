'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, 'CONFIG', 'state_sled_fl_lead_reconciliation_rules.json');

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function run() {
  const rules = loadRules();
  if (rules.readOnly !== true) throw new Error('P1.3O must remain read-only.');

  const verifiedFile = path.join(ROOT, rules.verifiedMasterFile);
  if (!fs.existsSync(verifiedFile)) throw new Error(`Verified master not found: ${verifiedFile}`);

  const verifiedRows = await readCsv(verifiedFile);
  const verifiedEmails = new Set(
    verifiedRows
      .filter(row => first(row, ['state', 'State', 'NORMALIZED_STATE']).toUpperCase() === rules.state)
      .map(row => normalizeEmail(first(row, ['discoveredEmail', 'email', 'Email'])))
      .filter(Boolean)
  );

  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const campaignResult = await connector.execute({ action: 'getCampaign', payload: { campaign_id: rules.campaignId } });
  const campaign = campaignResult?.campaign || campaignResult?.result || {};

  let startingAfter = null;
  const liveLeads = [];
  const seenIds = new Set();
  for (let page = 0; page < 20; page += 1) {
    const payload = { campaign: rules.campaignId, limit: 100 };
    if (startingAfter) payload.starting_after = startingAfter;
    const result = await connector.execute({ action: 'listLeads', payload });
    const items = unwrapItems(result?.leads);
    for (const lead of items) {
      const id = String(lead?.id || lead?.lead_id || '').trim();
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      liveLeads.push(lead);
    }
    const next = result?.leads?.next_starting_after || result?.leads?.next_cursor || result?.leads?.starting_after || null;
    if (!next || !items.length || next === startingAfter) break;
    startingAfter = next;
  }

  const liveEmails = new Map();
  for (const lead of liveLeads) {
    const email = normalizeEmail(lead?.email || lead?.contact_email || lead?.email_address);
    if (!email) continue;
    if (!liveEmails.has(email)) liveEmails.set(email, []);
    liveEmails.get(email).push(lead);
  }

  const matchedVerified = [];
  const unexpectedLive = [];
  for (const [email, leads] of liveEmails.entries()) {
    if (verifiedEmails.has(email)) matchedVerified.push({ email, count: leads.length });
    else unexpectedLive.push({ email, count: leads.length, leadIds: leads.map(x => x.id || x.lead_id || null) });
  }

  const missingVerified = [...verifiedEmails]
    .filter(email => !liveEmails.has(email))
    .map(email => ({ email }));

  const duplicateLiveEmails = [...liveEmails.entries()]
    .filter(([, leads]) => leads.length > 1)
    .map(([email, leads]) => ({ email, count: leads.length, leadIds: leads.map(x => x.id || x.lead_id || null) }));

  const uniqueLiveEmailCount = liveEmails.size;
  const observedLeadObjects = liveLeads.length;
  const expectedVerifiedLeadCount = verifiedEmails.size;
  const exactSetMatch = unexpectedLive.length === 0 && missingVerified.length === 0 && duplicateLiveEmails.length === 0;

  const summary = {
    ok: true,
    gate: rules.gate,
    campaign: {
      id: campaign?.id || rules.campaignId,
      name: campaign?.name || null,
      status: campaign?.status ?? null
    },
    expectedVerifiedLeadCount,
    observedLeadObjects,
    uniqueLiveEmailCount,
    matchedVerifiedCount: matchedVerified.length,
    unexpectedLiveCount: unexpectedLive.length,
    missingVerifiedCount: missingVerified.length,
    duplicateLiveEmailCount: duplicateLiveEmails.length,
    exactSetMatch,
    checks: {
      campaignIdExact: String(campaign?.id || '') === rules.campaignId,
      campaignNameExact: String(campaign?.name || '') === rules.campaignName,
      campaignActive: Number(campaign?.status) === 1,
      verifiedCountExpected: expectedVerifiedLeadCount === Number(rules.expectedVerifiedLeadCount),
      noUnexpectedLiveEmails: unexpectedLive.length === 0,
      noMissingVerifiedEmails: missingVerified.length === 0,
      noDuplicateLiveEmails: duplicateLiveEmails.length === 0
    },
    safety: rules.safety,
    details: { unexpectedLive, missingVerified, duplicateLiveEmails }
  };

  summary.failedChecks = Object.entries(summary.checks).filter(([, value]) => !value).map(([key]) => key);

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'LEAD_RECONCILIATION');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_SLED_FL_LEAD_RECONCILIATION.json');
  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  summary.outputFile = outputFile;

  return summary;
}

module.exports = { run, normalizeEmail, unwrapItems };
