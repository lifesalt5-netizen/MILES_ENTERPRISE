'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const ROOT = process.cwd();
const DEPLOYMENT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'DEPLOYMENT', 'STATE_REVENUE_DEPLOYMENT_LATEST.json');
const VERIFIED_MASTER_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'INSTANTLY_RECONCILIATION', 'STATE_SLED_WAVE1_VERIFIED_MASTER.csv');
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'LEAD_RECONCILIATION');

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

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

async function readAllCampaignLeads(connector, campaignId) {
  const rows = [];
  const seen = new Set();
  let startingAfter;

  for (let page = 0; page < 200; page += 1) {
    const payload = { campaign: campaignId, limit: 100, distinct_contacts: false };
    if (startingAfter) payload.starting_after = startingAfter;

    const result = await connector.execute({ action: 'listLeads', payload });
    const envelope = result?.leads || result?.result || {};
    const items = unwrapItems(envelope);

    for (const item of items) {
      const id = String(item?.id || item?.email || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(item);
    }

    if (items.length === 0 || items.length < 100) break;

    const lastItemId = String(items[items.length - 1]?.id || '').trim();
    if (!lastItemId || lastItemId === startingAfter) break;
    startingAfter = lastItemId;
  }

  return rows;
}

async function run() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error(`Deployment artifact not found: ${DEPLOYMENT_FILE}`);
  if (!fs.existsSync(VERIFIED_MASTER_FILE)) throw new Error(`Verified master not found: ${VERIFIED_MASTER_FILE}`);

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  const masterRows = await readCsv(VERIFIED_MASTER_FILE);
  const connector = require('../CONNECTORS/INSTANTLY/connector');

  const byState = new Map();
  for (const row of masterRows) {
    const state = first(row, ['state','State','NORMALIZED_STATE']).toUpperCase();
    const email = first(row, ['discoveredEmail','email','Email']).toLowerCase();
    if (!state || !email) continue;
    if (!byState.has(state)) byState.set(state, new Map());
    if (!byState.get(state).has(email)) byState.get(state).set(email, row);
  }

  const states = [];
  for (const stateRow of deployment.states || []) {
    if (!stateRow.campaignId) {
      states.push({ state: stateRow.state, status: 'NOT_DEPLOYED', expected: Number(stateRow.verifiedLeads || 0), live: 0, missing: 0, unexpected: 0 });
      continue;
    }

    const expectedMap = byState.get(stateRow.state) || new Map();
    const liveLeads = await readAllCampaignLeads(connector, stateRow.campaignId);
    const liveMap = new Map();
    for (const lead of liveLeads) {
      const email = String(lead?.email || lead?.contact || '').trim().toLowerCase();
      if (email && !liveMap.has(email)) liveMap.set(email, lead);
    }

    const missing = [...expectedMap.keys()].filter(email => !liveMap.has(email));
    const unexpected = [...liveMap.keys()].filter(email => !expectedMap.has(email));

    const analyticsResult = await connector.execute({ action: 'getCampaignAnalytics', payload: { id: stateRow.campaignId } });
    const analyticsEnvelope = analyticsResult?.analytics || analyticsResult?.result || {};
    const analytics = Array.isArray(analyticsEnvelope) ? (analyticsEnvelope[0] || {}) : analyticsEnvelope;
    const sent = Number(analytics?.sent || analytics?.emails_sent || analytics?.sent_count || 0);
    const bounced = Number(analytics?.bounced || analytics?.bounce_count || analytics?.bounces || 0);
    const bounceRate = sent > 0 ? bounced / sent : 0;

    let bounceClassification = 'NO_SENDS_YET';
    if (sent > 0 && bounced === 0) bounceClassification = 'NO_BOUNCES';
    if (sent > 0 && bounced > 0 && sent < 50) bounceClassification = 'SMALL_SAMPLE_MONITOR';
    if (sent >= 50 && bounceRate < 0.03) bounceClassification = 'HEALTHY';
    if (sent >= 50 && bounceRate >= 0.03 && bounceRate < 0.05) bounceClassification = 'WATCH';
    if (sent >= 50 && bounceRate >= 0.05) bounceClassification = 'HIGH_BOUNCE_REVIEW';

    states.push({
      state: stateRow.state,
      campaignId: stateRow.campaignId,
      expected: expectedMap.size,
      live: liveMap.size,
      missing: missing.length,
      unexpected: unexpected.length,
      missingEmails: missing,
      unexpectedEmails: unexpected,
      sent,
      bounced,
      bounceRate,
      bounceClassification,
      correctiveUploadRecommended: missing.length > 0 && unexpected.length === 0,
      pauseRecommended: sent >= 50 && bounceRate >= 0.05
    });
  }

  const result = {
    ok: true,
    gate: 'P1.4C2_STATE_REVENUE_LEAD_RECONCILIATION_AND_BOUNCE_CLASSIFICATION',
    generatedAt: new Date().toISOString(),
    states,
    totals: {
      expected: states.reduce((n,x) => n + Number(x.expected || 0), 0),
      live: states.reduce((n,x) => n + Number(x.live || 0), 0),
      missing: states.reduce((n,x) => n + Number(x.missing || 0), 0),
      unexpected: states.reduce((n,x) => n + Number(x.unexpected || 0), 0)
    },
    safety: {
      readOnly: true,
      uploadLeads: false,
      pauseCampaigns: false,
      activateCampaigns: false,
      deleteCampaigns: false,
      sendReplies: false
    }
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  result.outputFile = path.join(OUTPUT_DIR, 'STATE_REVENUE_LEAD_RECONCILIATION_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, unwrapItems, readAllCampaignLeads };
