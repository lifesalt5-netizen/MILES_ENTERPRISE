'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_STAGES = [
  'Target',
  'Contacted',
  'Engaged',
  'Qualified',
  'Meeting Set',
  'Meeting Held',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
  'Client'
];

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegative(value) {
  const n = finiteNumber(value);
  return n === null ? 0 : Math.max(0, n);
}

function clean(value) {
  return String(value || '').trim();
}

function recordKey(record = {}) {
  return clean(record.id || record.email || record.contactEmail || record.uei || record.companyDomain || record.legalName || record.companyName);
}

function verifiedRevenueUsd(record = {}) {
  const direct = finiteNumber(record.verifiedRevenueUsd);
  if (direct !== null && direct >= 0) return direct;

  if (record.revenueVerified !== true) return 0;

  const keys = ['revenueUsd', 'revenue', 'wonRevenue', 'dealValue', 'contractValue', 'amount', 'paidAmount'];
  for (const key of keys) {
    const value = finiteNumber(record[key]);
    if (value !== null && value >= 0) return value;
  }
  return 0;
}

function percentage(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function perThousand(value, delivered) {
  return delivered > 0 ? (value / delivered) * 1000 : 0;
}

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

class RevenueWeightedCampaignScorecardService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.rulesPath = options.rulesPath || path.join(this.rootDir, 'CONFIG', 'p2gc_revenue_scorecard_rules.json');
    this.rules = options.rules || readJson(this.rulesPath, {});
    this.stages = Array.isArray(this.rules.stage_order) && this.rules.stage_order.length
      ? this.rules.stage_order
      : DEFAULT_STAGES;
    this.minimumDeliveredSample = nonNegative(this.rules.minimum_delivered_sample || 250);
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'revenue_pipeline');
    this.outputJson = path.join(this.outputDir, 'latest_revenue_weighted_campaign_scorecard.json');
    this.outputCsv = path.join(this.outputDir, 'latest_revenue_weighted_campaign_scorecard.csv');
  }

  stageIndex(stage) {
    const index = this.stages.indexOf(clean(stage));
    return index >= 0 ? index : 0;
  }

  atLeast(record, stage) {
    return this.stageIndex(record?.stage || 'Target') >= this.stageIndex(stage);
  }

  campaignRecords(records, campaignId) {
    const id = clean(campaignId);
    if (!id) return [];
    const seen = new Set();
    const result = [];

    for (const record of Array.isArray(records) ? records : []) {
      if (clean(record?.campaignId || record?.campaign_id) !== id) continue;
      const key = recordKey(record) || JSON.stringify(record);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(record);
    }

    return result;
  }

  classify(row) {
    if (row.delivered < this.minimumDeliveredSample) return 'INSUFFICIENT_SAMPLE';
    if (row.verifiedRevenueUsd > 0) return 'PROVEN_REVENUE';
    if (row.wonCount > 0) return 'WON_REVENUE_UNVERIFIED';
    if (row.proposalCount > 0) return 'PROPOSAL_TRACTION';
    if (row.meetingHeldCount > 0) return 'MEETING_TRACTION';
    if (row.qualifiedReplyCount > 0) return 'QUALIFIED_TRACTION';
    return 'NO_DOWNSTREAM_TRACTION';
  }

  recommendation(row) {
    switch (row.decisionClass) {
      case 'PROVEN_REVENUE':
        return 'SCALE_OR_PROTECT_WINNER';
      case 'WON_REVENUE_UNVERIFIED':
        return 'VERIFY_REVENUE_BEFORE_SCALING';
      case 'PROPOSAL_TRACTION':
        return 'KEEP_RUNNING_AND_OPTIMIZE_CLOSE_RATE';
      case 'MEETING_TRACTION':
        return 'KEEP_RUNNING_AND_OPTIMIZE_MEETING_TO_PROPOSAL';
      case 'QUALIFIED_TRACTION':
        return 'KEEP_RUNNING_AND_OPTIMIZE_QUALIFIED_TO_MEETING';
      case 'NO_DOWNSTREAM_TRACTION':
        return 'REVIEW_OFFER_TARGETING_AND_COPY';
      default:
        return 'COLLECT_MORE_DELIVERED_SAMPLE';
    }
  }

  buildCampaignRow(campaign = {}, crmRecords = []) {
    const campaignId = clean(campaign.campaignId || campaign.id);
    const records = this.campaignRecords(crmRecords, campaignId);
    const sent = nonNegative(campaign.sent);
    const bounced = nonNegative(campaign.bounced);
    const replies = nonNegative(campaign.replies);
    const delivered = Math.max(0, sent - bounced);

    const qualifiedReplyCount = records.filter(r => this.atLeast(r, 'Qualified')).length;
    const meetingBookedCount = records.filter(r => this.atLeast(r, 'Meeting Set')).length;
    const meetingHeldCount = records.filter(r => this.atLeast(r, 'Meeting Held')).length;
    const proposalCount = records.filter(r => this.atLeast(r, 'Proposal')).length;
    const wonRecords = records.filter(r => ['Won', 'Client'].includes(clean(r.stage)));
    const wonCount = wonRecords.length;
    const verifiedRevenue = wonRecords.reduce((sum, record) => sum + verifiedRevenueUsd(record), 0);
    const wonWithoutVerifiedRevenue = wonRecords.filter(record => verifiedRevenueUsd(record) === 0).length;

    const row = {
      campaignId,
      campaignName: clean(campaign.campaignName || campaign.name),
      family: clean(campaign.family || 'OTHER'),
      statusLabel: clean(campaign.statusLabel || ''),
      sent,
      bounced,
      delivered,
      rawReplyCount: replies,
      qualifiedReplyCount,
      meetingBookedCount,
      meetingHeldCount,
      proposalCount,
      wonCount,
      verifiedRevenueUsd: verifiedRevenue,
      wonWithoutVerifiedRevenue,
      replyRate: percentage(replies, delivered),
      qualifiedReplyRate: percentage(qualifiedReplyCount, delivered),
      meetingBookedRate: percentage(meetingBookedCount, delivered),
      meetingShowRate: percentage(meetingHeldCount, meetingBookedCount),
      proposalRateFromHeldMeetings: percentage(proposalCount, meetingHeldCount),
      closeRateFromProposals: percentage(wonCount, proposalCount),
      revenuePer1000Delivered: perThousand(verifiedRevenue, delivered),
      crmAttributedRecords: records.length,
      evidenceGaps: []
    };

    if (wonWithoutVerifiedRevenue > 0) {
      row.evidenceGaps.push('WON_OR_CLIENT_RECORD_WITHOUT_VERIFIED_REVENUE');
    }
    if (replies > 0 && qualifiedReplyCount === 0) {
      row.evidenceGaps.push('RAW_REPLIES_NOT_ATTRIBUTED_TO_QUALIFIED_CRM_RECORDS');
    }

    row.decisionClass = this.classify(row);
    row.recommendation = this.recommendation(row);
    return row;
  }

  compareRows(a, b) {
    const fields = [
      'verifiedRevenueUsd',
      'wonCount',
      'proposalCount',
      'meetingHeldCount',
      'meetingBookedCount',
      'qualifiedReplyCount',
      'revenuePer1000Delivered'
    ];

    for (const field of fields) {
      const diff = nonNegative(b[field]) - nonNegative(a[field]);
      if (diff !== 0) return diff;
    }
    return clean(a.campaignName).localeCompare(clean(b.campaignName));
  }

  buildScorecard(campaigns = [], crmRecords = []) {
    const rows = (Array.isArray(campaigns) ? campaigns : [])
      .map(campaign => this.buildCampaignRow(campaign, crmRecords))
      .sort((a, b) => this.compareRows(a, b))
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const totals = rows.reduce((acc, row) => {
      for (const field of [
        'sent', 'bounced', 'delivered', 'rawReplyCount', 'qualifiedReplyCount',
        'meetingBookedCount', 'meetingHeldCount', 'proposalCount', 'wonCount',
        'verifiedRevenueUsd'
      ]) {
        acc[field] += nonNegative(row[field]);
      }
      return acc;
    }, {
      campaigns: rows.length,
      sent: 0,
      bounced: 0,
      delivered: 0,
      rawReplyCount: 0,
      qualifiedReplyCount: 0,
      meetingBookedCount: 0,
      meetingHeldCount: 0,
      proposalCount: 0,
      wonCount: 0,
      verifiedRevenueUsd: 0
    });

    totals.revenuePer1000Delivered = perThousand(totals.verifiedRevenueUsd, totals.delivered);
    totals.qualifiedReplyRate = percentage(totals.qualifiedReplyCount, totals.delivered);
    totals.meetingBookedRate = percentage(totals.meetingBookedCount, totals.delivered);
    totals.meetingShowRate = percentage(totals.meetingHeldCount, totals.meetingBookedCount);
    totals.proposalRateFromHeldMeetings = percentage(totals.proposalCount, totals.meetingHeldCount);
    totals.closeRateFromProposals = percentage(totals.wonCount, totals.proposalCount);

    return {
      ok: true,
      service: 'P2GC_REVENUE_WEIGHTED_CAMPAIGN_SCORECARD',
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      governingRule: 'Promote campaigns based on verified downstream revenue and conversion evidence, not opens.',
      minimumDeliveredSample: this.minimumDeliveredSample,
      totals,
      campaigns: rows,
      evidenceRules: {
        opensExcludedFromPrimaryDecisioning: true,
        verifiedRevenueOnly: true,
        crmCampaignAttributionRequiredForDownstreamStages: true
      }
    };
  }

  async run(options = {}) {
    let reconciliation = options.reconciliation || null;
    if (!reconciliation) {
      const MasterInstantlyRevenueReconciliationService = require('../MasterInstantlyRevenueReconciliationService');
      reconciliation = await MasterInstantlyRevenueReconciliationService.run();
    }

    let crmRecords = options.crmRecords || null;
    if (!crmRecords) {
      const crm = options.crm || require('../CanonicalCrmService');
      crmRecords = typeof crm.listRecords === 'function' ? crm.listRecords() : [];
    }

    const scorecard = this.buildScorecard(reconciliation?.campaigns || [], crmRecords || []);
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(this.outputJson, JSON.stringify(scorecard, null, 2), 'utf8');

    const headers = [
      'rank','campaignId','campaignName','family','statusLabel','sent','bounced','delivered',
      'rawReplyCount','qualifiedReplyCount','meetingBookedCount','meetingHeldCount','proposalCount',
      'wonCount','verifiedRevenueUsd','revenuePer1000Delivered','qualifiedReplyRate','meetingBookedRate',
      'meetingShowRate','proposalRateFromHeldMeetings','closeRateFromProposals','decisionClass','recommendation','evidenceGaps'
    ];
    const lines = [headers.join(',')];
    for (const row of scorecard.campaigns) {
      const record = { ...row, evidenceGaps: row.evidenceGaps.join(';') };
      lines.push(headers.map(header => csvEscape(record[header])).join(','));
    }
    fs.writeFileSync(this.outputCsv, lines.join('\n'), 'utf8');

    scorecard.outputJson = this.outputJson;
    scorecard.outputCsv = this.outputCsv;
    return scorecard;
  }
}

module.exports = RevenueWeightedCampaignScorecardService;
module.exports.verifiedRevenueUsd = verifiedRevenueUsd;
