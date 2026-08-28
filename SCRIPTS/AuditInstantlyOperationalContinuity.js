'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ReplyIntelligenceService = require('../SERVICES/revenue/ReplyIntelligenceService');
const GlobalSuppressionService = require('../SERVICES/revenue/GlobalSuppressionService');

function deepArray(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  for (const k of ['analytics','items','data','campaigns','accounts','emails','results']) {
    if (Array.isArray(v[k])) return v[k];
    const nested = deepArray(v[k]);
    if (nested.length) return nested;
  }
  return [];
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function sent(row = {}) { return num(row.emails_sent_count ?? row.sent_count ?? row.sent ?? row.contacted_count); }
function bounced(row = {}) { return num(row.bounced_count ?? row.bounce_count ?? row.bounced ?? row.bounces); }
function bounceRatePct(row = {}) { const s = sent(row); return s > 0 ? Number(((bounced(row) / s) * 100).toFixed(2)) : 0; }
function bounceStatus(row = {}, minVolume = 100) {
  const s = sent(row); const rate = bounceRatePct(row);
  if (s < minVolume) return 'INSUFFICIENT_VOLUME';
  if (rate >= 3) return 'RED';
  if (rate >= 2) return 'WATCH';
  return 'GREEN';
}
function emailFrom(value = '') {
  const t = String(value || '').trim().toLowerCase();
  const m = t.match(/<([^<>\s]+@[^<>\s]+)>/) || t.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? String(m[1] || m[0]).toLowerCase() : '';
}
function openInstantlyBlockers(filePath) {
  try {
    const x = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return (Array.isArray(x.blockers) ? x.blockers : []).filter(b => String(b.system).toUpperCase() === 'INSTANTLY' && String(b.status).toUpperCase() === 'OPEN');
  } catch { return []; }
}
async function safeCall(connector, action, payload) {
  try {
    const value = await connector.execute({ action, payload }, { audit: true, readOnly: true });
    return { ok: value?.ok !== false, value, error: null };
  } catch (error) { return { ok: false, value: null, error: error.message }; }
}

async function run(options = {}) {
  const root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
  const connector = options.connector || require(path.join(root, 'CONNECTORS', 'INSTANTLY', 'connector.js'));
  const classifier = options.classifier || new ReplyIntelligenceService();
  const suppression = options.suppression || new GlobalSuppressionService({ rootDir: root });
  const blockerPath = options.blockerPath || path.join(root, 'DATA', 'operational_acceptance', 'manual_external_blockers.json');
  const output = options.output || path.join(root, 'DATA', 'operational_acceptance', 'latest_instantly_operational_continuity.json');

  const [campaignsCall, accountsCall, analyticsCall, emailsCall] = await Promise.all([
    safeCall(connector, 'listCampaigns', { limit: 100 }),
    safeCall(connector, 'listAccounts', { limit: 100 }),
    safeCall(connector, 'getCampaignAnalytics', {}),
    safeCall(connector, 'listEmails', { limit: 100, email_type: 'received' })
  ]);

  const campaigns = deepArray(campaignsCall.value);
  const accounts = deepArray(accountsCall.value);
  const analytics = deepArray(analyticsCall.value);
  const emails = deepArray(emailsCall.value);
  const manualBlockers = openInstantlyBlockers(blockerPath);

  const campaignHealth = analytics.map(row => ({
    campaignId: row.campaign_id || row.id || null,
    name: String(row.campaign_name || row.name || '').trim(),
    providerStatus: row.campaign_status ?? row.status ?? null,
    sent: sent(row),
    bounced: bounced(row),
    bounceRatePct: bounceRatePct(row),
    bounceStatus: bounceStatus(row),
    replies: num(row.reply_count ?? row.replies),
    opportunities: num(row.total_opportunities ?? row.opportunities)
  }));

  const classified = emails.map(email => classifier.classify(email));
  const hard = new Set(['UNSUBSCRIBE','NEGATIVE','BOUNCE_TECHNICAL']);
  const unsuppressedHard = classified.filter(item => {
    if (!hard.has(item.category)) return false;
    const email = emailFrom(item.from);
    return Boolean(email) && !suppression.isSuppressed(email);
  });
  const automatedNoise = classified.filter(item => ['AUTO_REPLY','OOO','BOUNCE_TECHNICAL','INBOUND_SOLICITATION_SPAM'].includes(item.category));
  const humanActionable = classified.filter(item => item.humanReply && !['UNSUBSCRIBE','NEGATIVE'].includes(item.category));

  const providerErrors = [campaignsCall, accountsCall, analyticsCall, emailsCall].filter(x => !x.ok).map(x => x.error || 'PROVIDER_READ_FAILED');
  const bounceRed = campaignHealth.filter(x => x.bounceStatus === 'RED');
  const bounceWatch = campaignHealth.filter(x => x.bounceStatus === 'WATCH');
  const billingOpen = manualBlockers.some(b => b.id === 'INSTANTLY_BILLING_PAYMENT_FAILED');

  const status = providerErrors.length || billingOpen || bounceRed.length || unsuppressedHard.length ? 'RED' :
    bounceWatch.length ? 'WATCH' : 'GREEN';

  const report = {
    generatedAt: new Date().toISOString(),
    audit: 'INSTANTLY_OPERATIONAL_CONTINUITY',
    mode: 'READ_ONLY_PROVIDER_RECONCILIATION',
    status,
    checks: {
      providerReadConnectivity: providerErrors.length ? 'RED' : 'GREEN',
      billingContinuity: billingOpen ? 'RED' : 'GREEN',
      campaignBounceHealth: bounceRed.length ? 'RED' : (bounceWatch.length ? 'WATCH' : 'GREEN'),
      hardSuppressionCoverage: unsuppressedHard.length ? 'RED' : 'GREEN',
      uniboxReplyVisibility: emailsCall.ok ? 'GREEN' : 'RED'
    },
    inventory: { campaigns: campaigns.length, accounts: accounts.length, analyticsRows: analytics.length, receivedEmailsSampled: emails.length },
    campaignHealth,
    replyHygiene: {
      classified: classified.length,
      automatedNoise: automatedNoise.length,
      humanActionable: humanActionable.length,
      hardSuppressionCandidates: classified.filter(x => hard.has(x.category)).length,
      unsuppressedHard: unsuppressedHard.map(x => ({ from: x.from, category: x.category, subject: x.subject }))
    },
    manualBlockers,
    providerErrors,
    safety: { readOnlyProviderCalls: true, providerMutation: false, sendsProspects: false, deletesEmail: false, changesDns: false, changesB12: false },
    nextAction: billingOpen ? 'RESOLVE_INSTANTLY_BILLING_FAILURE' :
      bounceRed.length ? 'REMEDIATE_RED_BOUNCE_CAMPAIGNS_BEFORE_ACTIVE_USE' :
      unsuppressedHard.length ? 'COMPLETE_HARD_SUPPRESSION_COVERAGE' :
      bounceWatch.length ? 'MONITOR_AND_REMEDIATE_WATCH_BOUNCE_CAMPAIGNS' : 'NONE'
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function main() {
  console.log('============================================================');
  console.log('MILES INSTANTLY OPERATIONAL CONTINUITY - LIVE READ ONLY');
  console.log('============================================================');
  const r = await run();
  console.log(`Status: ${r.status}`);
  for (const [k,v] of Object.entries(r.checks)) console.log(`${k}: ${v}`);
  console.log(`Campaigns: ${r.inventory.campaigns}`);
  console.log(`Accounts: ${r.inventory.accounts}`);
  console.log(`Analytics rows: ${r.inventory.analyticsRows}`);
  console.log(`Received emails sampled: ${r.inventory.receivedEmailsSampled}`);
  for (const c of r.campaignHealth) console.log(`${c.name || c.campaignId}: sent=${c.sent} bounced=${c.bounced} bounceRate=${c.bounceRatePct}% status=${c.bounceStatus}`);
  console.log(`Unsuppressed hard failures: ${r.replyHygiene.unsuppressedHard.length}`);
  console.log(`Open manual blockers: ${r.manualBlockers.length}`);
  console.log(`Next action: ${r.nextAction}`);
  console.log('External writes performed: False');
  console.log(`RESULT: INSTANTLY_OPERATIONAL_CONTINUITY_${r.status}`);
  if (r.status !== 'GREEN') process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { run, deepArray, sent, bounced, bounceRatePct, bounceStatus, emailFrom, openInstantlyBlockers };
