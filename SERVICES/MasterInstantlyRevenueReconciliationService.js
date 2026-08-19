'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'MASTER_INSTANTLY_RECONCILIATION_LATEST.json');
const CSV_FILE = path.join(OUTPUT_DIR, 'MASTER_INSTANTLY_RECONCILIATION_LATEST.csv');

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function statusLabel(value) {
  const n = Number(value);
  if (n === 0) return 'DRAFT';
  if (n === 1) return 'ACTIVE';
  if (n === 2) return 'PAUSED';
  return `STATUS_${String(value)}`;
}

function campaignFamily(name = '') {
  const n = String(name).toUpperCase();
  if (n.includes('STATE SLED')) return 'STATE_SLED';
  if (n.includes('EXPIR')) return 'EXPIRATION';
  if (n.includes('GSA')) return 'GSA';
  if (n.includes('VA')) return 'VA';
  if (n.includes('SAM')) return 'SAM';
  if (n.includes('SBS')) return 'SBS';
  if (n.includes('8A') || n.includes('8(A)') || n.includes('HUBZONE') || n.includes('WOSB') || n.includes('SDVOSB') || n.includes('VOSB')) return 'CERTIFICATION';
  if (n.includes('NURTURE')) return 'NURTURE';
  if (n.includes('MEETING')) return 'MEETING_PIPELINE';
  if (n.includes('SUPPRESS')) return 'SUPPRESSION';
  if (n.includes('PIPELINE')) return 'PIPELINE';
  if (n.includes('FOLLOW-UP') || n.includes('FOLLOW UP')) return 'FOLLOW_UP';
  return 'OTHER';
}

async function readAllCampaigns(connector) {
  const rows = [];
  const seen = new Set();
  let startingAfter;
  for (let page = 0; page < 100; page += 1) {
    const payload = { limit: 100 };
    if (startingAfter) payload.starting_after = startingAfter;
    const result = await connector.execute({ action: 'listCampaigns', payload });
    const envelope = result?.campaigns || result?.result || {};
    const items = unwrapItems(envelope);
    for (const item of items) {
      const id = String(item?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(item);
    }
    const next = envelope?.next_starting_after || envelope?.nextStartingAfter || null;
    if (!next || items.length === 0 || next === startingAfter) break;
    startingAfter = next;
  }
  return rows;
}

async function readAllCampaignLeads(connector, campaignId) {
  const rows = [];
  const seen = new Set();
  let startingAfter;
  for (let page = 0; page < 500; page += 1) {
    const payload = { campaign: campaignId, limit: 100, distinct_contacts: true };
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
    const apiCursor = envelope?.next_starting_after || envelope?.nextStartingAfter || null;
    const lastLeadId = items.length ? String(items[items.length - 1]?.id || '') : '';
    const next = apiCursor || lastLeadId || null;
    if (!next || items.length === 0 || next === startingAfter) break;
    startingAfter = next;
  }
  return rows;
}

function sequenceStepCount(campaign) {
  const sequences = Array.isArray(campaign?.sequences) ? campaign.sequences : [];
  return sequences.reduce((n, seq) => n + (Array.isArray(seq?.steps) ? seq.steps.length : 0), 0);
}

function senderEmails(campaign) {
  const candidates = campaign?.email_list || campaign?.emailList || campaign?.accounts || [];
  return Array.isArray(candidates) ? candidates.map(String).filter(Boolean) : [];
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function run() {
  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const campaigns = await readAllCampaigns(connector);
  const rows = [];

  for (const base of campaigns) {
    const campaignId = String(base?.id || '');
    if (!campaignId) continue;

    const detailResult = await connector.execute({ action: 'getCampaign', payload: { id: campaignId } });
    const detail = detailResult?.campaign || detailResult?.result || base;
    const leads = await readAllCampaignLeads(connector, campaignId);
    const analyticsResult = await connector.execute({ action: 'getCampaignAnalytics', payload: { id: campaignId } });
    const analyticsEnvelope = analyticsResult?.analytics || analyticsResult?.result || {};
    const analytics = Array.isArray(analyticsEnvelope) ? (analyticsEnvelope[0] || {}) : analyticsEnvelope;

    const sent = Number(analytics?.sent || analytics?.emails_sent || analytics?.sent_count || 0);
    const replies = Number(analytics?.replies || analytics?.reply_count || analytics?.replies_count || 0);
    const bounced = Number(analytics?.bounced || analytics?.bounce_count || analytics?.bounces || 0);
    const opportunities = Number(analytics?.opportunities || analytics?.opportunity_count || analytics?.interested || 0);
    const leadCount = leads.length;
    const senders = senderEmails(detail);
    const steps = sequenceStepCount(detail);
    const status = Number(detail?.status ?? base?.status ?? -1);
    const family = campaignFamily(detail?.name || base?.name || '');

    const issues = [];
    if (leadCount === 0 && !['SUPPRESSION','NURTURE','MEETING_PIPELINE','PIPELINE','FOLLOW_UP'].includes(family)) issues.push('NO_LEADS');
    if (senders.length === 0 && status === 1) issues.push('ACTIVE_WITHOUT_SENDER');
    if (steps === 0 && status === 1) issues.push('ACTIVE_WITHOUT_SEQUENCE');
    if (status === 0 && leadCount > 0) issues.push('DRAFT_WITH_LEADS');
    if (status === 2 && leadCount > 0) issues.push('PAUSED_WITH_LEADS');

    rows.push({
      campaignId,
      campaignName: detail?.name || base?.name || '',
      family,
      status,
      statusLabel: statusLabel(status),
      leadCount,
      senderEmails: senders,
      senderCount: senders.length,
      sequenceStepCount: steps,
      dailyLimit: Number(detail?.daily_limit || detail?.dailyLimit || 0),
      stopOnReply: detail?.stop_on_reply ?? detail?.stopOnReply ?? null,
      openTracking: detail?.open_tracking ?? detail?.openTracking ?? null,
      linkTracking: detail?.link_tracking ?? detail?.linkTracking ?? null,
      schedulePresent: Boolean(detail?.campaign_schedule && Object.keys(detail.campaign_schedule).length),
      sent,
      replies,
      bounced,
      opportunities,
      issues,
      action: issues.length ? 'REVIEW_REQUIRED' : 'NO_IMMEDIATE_CONFIG_ISSUE'
    });
  }

  const byStatus = {};
  const byFamily = {};
  for (const row of rows) {
    byStatus[row.statusLabel] = (byStatus[row.statusLabel] || 0) + 1;
    byFamily[row.family] = (byFamily[row.family] || 0) + 1;
  }

  const result = {
    ok: true,
    gate: 'P1.5_MASTER_INSTANTLY_REVENUE_RECONCILIATION',
    generatedAt: new Date().toISOString(),
    totals: {
      campaigns: rows.length,
      leadsObservedAcrossCampaignMemberships: rows.reduce((n, x) => n + x.leadCount, 0),
      sent: rows.reduce((n, x) => n + x.sent, 0),
      replies: rows.reduce((n, x) => n + x.replies, 0),
      bounced: rows.reduce((n, x) => n + x.bounced, 0),
      opportunities: rows.reduce((n, x) => n + x.opportunities, 0),
      reviewRequired: rows.filter(x => x.issues.length).length
    },
    byStatus,
    byFamily,
    campaigns: rows,
    safety: {
      readOnly: true,
      createCampaigns: false,
      updateCampaigns: false,
      pauseCampaigns: false,
      activateCampaigns: false,
      uploadLeads: false,
      moveLeads: false,
      deleteCampaigns: false,
      sendReplies: false
    }
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  result.outputFile = OUTPUT_FILE;
  result.csvFile = CSV_FILE;
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

  const headers = ['campaignId','campaignName','family','statusLabel','leadCount','senderCount','senderEmails','sequenceStepCount','dailyLimit','stopOnReply','openTracking','linkTracking','schedulePresent','sent','replies','bounced','opportunities','issues','action'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const record = {
      ...row,
      senderEmails: row.senderEmails.join(';'),
      issues: row.issues.join(';')
    };
    lines.push(headers.map(h => csvEscape(record[h])).join(','));
  }
  fs.writeFileSync(CSV_FILE, lines.join('\n'));

  return result;
}

module.exports = { run, readAllCampaigns, readAllCampaignLeads, campaignFamily, statusLabel };
