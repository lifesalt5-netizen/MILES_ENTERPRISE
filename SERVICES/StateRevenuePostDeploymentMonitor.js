'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DEPLOYMENT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'DEPLOYMENT', 'STATE_REVENUE_DEPLOYMENT_LATEST.json');
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'POST_DEPLOYMENT_MONITORING');

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function numberFrom(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) throw new Error(`Deployment artifact not found: ${DEPLOYMENT_FILE}`);
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
}

async function countCampaignLeads(connector, campaignId, hardCap = 10000) {
  let total = 0;
  let startingAfter = undefined;
  const seen = new Set();
  for (let page = 0; page < 200 && total < hardCap; page += 1) {
    const payload = { campaign_id: campaignId, limit: 100 };
    if (startingAfter) payload.starting_after = startingAfter;
    const result = await connector.execute({ action: 'listLeads', payload });
    const envelope = result?.leads || result?.result || {};
    const items = unwrapItems(envelope);
    for (const item of items) {
      const key = String(item?.id || item?.email || JSON.stringify(item));
      if (!seen.has(key)) { seen.add(key); total += 1; }
    }
    const next = envelope?.next_starting_after || envelope?.nextStartingAfter || envelope?.starting_after || null;
    if (!next || items.length === 0 || next === startingAfter) break;
    startingAfter = next;
  }
  return total;
}

async function run() {
  const deployment = loadDeployment();
  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const monitored = [];

  for (const stateRow of deployment.states || []) {
    if (!stateRow.campaignId) {
      monitored.push({
        state: stateRow.state,
        campaignName: stateRow.campaignName,
        status: 'NOT_DEPLOYED',
        expectedLeads: Number(stateRow.verifiedLeads || 0)
      });
      continue;
    }

    const campaignResult = await connector.execute({ action: 'getCampaign', payload: { campaign_id: stateRow.campaignId } });
    const campaign = campaignResult?.campaign || campaignResult?.result || {};
    const analyticsResult = await connector.execute({ action: 'getCampaignAnalytics', payload: { campaign_id: stateRow.campaignId } });
    const analyticsEnvelope = analyticsResult?.analytics || analyticsResult?.result || {};
    const analytics = Array.isArray(analyticsEnvelope) ? (analyticsEnvelope[0] || {}) : analyticsEnvelope;
    const observedLeadCount = await countCampaignLeads(connector, stateRow.campaignId);

    const sent = numberFrom(analytics, ['sent','emails_sent','sent_count','total_sent']);
    const replies = numberFrom(analytics, ['replies','reply_count','total_replies']);
    const bounced = numberFrom(analytics, ['bounced','bounce_count','bounces']);
    const expectedLeads = Number(stateRow.verifiedLeads || 0);
    const bounceRate = sent > 0 ? bounced / sent : 0;
    const replyRate = sent > 0 ? replies / sent : 0;

    const checks = {
      campaignExists: Boolean(campaign?.id),
      campaignIdExact: String(campaign?.id || '') === String(stateRow.campaignId),
      campaignNameExact: String(campaign?.name || '').trim().toUpperCase() === String(stateRow.campaignName || '').trim().toUpperCase(),
      campaignActive: Number(campaign?.status) === 1,
      leadCountMatchesDeployment: observedLeadCount === expectedLeads,
      bounceRateWithinThreshold: sent === 0 || bounceRate < 0.05
    };

    const recommendations = [];
    if (!checks.campaignActive) recommendations.push('INVESTIGATE_CAMPAIGN_NOT_ACTIVE');
    if (!checks.leadCountMatchesDeployment) recommendations.push('RECONCILE_LIVE_LEAD_COUNT');
    if (!checks.bounceRateWithinThreshold) recommendations.push('PAUSE_RECOMMENDED_HIGH_BOUNCE_RATE');
    if (sent >= 100 && replyRate < 0.01) recommendations.push('REVIEW_COPY_OR_TARGETING_LOW_REPLY_RATE');

    monitored.push({
      state: stateRow.state,
      campaignName: stateRow.campaignName,
      campaignId: stateRow.campaignId,
      campaignStatus: campaign?.status ?? null,
      expectedLeads,
      observedLeadCount,
      sent,
      replies,
      bounced,
      replyRate,
      bounceRate,
      checks,
      failedChecks: Object.entries(checks).filter(([,ok]) => !ok).map(([name]) => name),
      recommendations
    });
  }

  const result = {
    ok: monitored.every(x => !x.failedChecks || x.failedChecks.length === 0),
    gate: 'P1.4C_STATE_REVENUE_POST_DEPLOYMENT_MONITORING',
    generatedAt: new Date().toISOString(),
    monitored,
    totals: {
      campaignsMonitored: monitored.filter(x => x.campaignId).length,
      campaignsActive: monitored.filter(x => x.campaignId && Number(x.campaignStatus) === 1).length,
      expectedLeads: monitored.reduce((n,x) => n + Number(x.expectedLeads || 0), 0),
      observedLeads: monitored.reduce((n,x) => n + Number(x.observedLeadCount || 0), 0),
      sent: monitored.reduce((n,x) => n + Number(x.sent || 0), 0),
      replies: monitored.reduce((n,x) => n + Number(x.replies || 0), 0),
      bounced: monitored.reduce((n,x) => n + Number(x.bounced || 0), 0)
    },
    safety: {
      readOnly: true,
      pauseCampaigns: false,
      activateCampaigns: false,
      uploadLeads: false,
      sendReplies: false,
      deleteCampaigns: false
    }
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  result.outputFile = path.join(OUTPUT_DIR, 'STATE_REVENUE_POST_DEPLOYMENT_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, unwrapItems, numberFrom, countCampaignLeads };
