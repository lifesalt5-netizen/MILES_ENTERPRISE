'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const master = require('./MasterInstantlyRevenueReconciliationService');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_DEPLOYMENT_PLAN_LATEST.json');
const CSV_FILE = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_DEPLOYMENT_PLAN_LATEST.csv');

const PRIORITY = {
  EXPIRATION: 10,
  GSA: 20,
  VA: 30,
  SAM: 40,
  CERTIFICATION: 50,
  SBS: 60,
  STATE_SLED: 70,
  NURTURE: 80,
  FOLLOW_UP: 81,
  MEETING_PIPELINE: 90,
  PIPELINE: 91,
  SUPPRESSION: 99,
  OTHER: 100
};

function classify(row) {
  const n = String(row.campaignName || '').toUpperCase();
  if (row.family === 'SUPPRESSION' || row.family === 'MEETING_PIPELINE' || row.family === 'PIPELINE' || row.family === 'NURTURE' || row.family === 'FOLLOW_UP') {
    return { disposition: 'RETAIN_WORKFLOW_CAMPAIGN', activationCandidate: false, reason: 'WORKFLOW_OR_SUPPRESSION_CAMPAIGN' };
  }
  if (row.statusLabel === 'ACTIVE') {
    return { disposition: 'KEEP_ACTIVE_MONITOR', activationCandidate: false, reason: 'CURRENTLY_ACTIVE' };
  }
  if (row.leadCount > 0 && row.sequenceStepCount >= 1 && row.senderCount >= 1) {
    return { disposition: 'READY_FOR_GOVERNED_REACTIVATION_REVIEW', activationCandidate: true, reason: 'LEADS_SEQUENCE_SENDERS_PRESENT' };
  }
  if (row.leadCount > 0) {
    return { disposition: 'REPAIR_CONFIGURATION', activationCandidate: false, reason: 'LEADS_PRESENT_BUT_CONFIG_INCOMPLETE' };
  }
  if (row.leadCount === 0 && row.statusLabel === 'DRAFT') {
    return { disposition: 'EMPTY_DRAFT_REVIEW', activationCandidate: false, reason: 'NO_LEADS' };
  }
  if (n.includes('AI SDR')) {
    return { disposition: 'LEGACY_OR_EXPERIMENT_REVIEW', activationCandidate: false, reason: 'NONSTANDARD_CAMPAIGN' };
  }
  return { disposition: 'MANUAL_REVIEW', activationCandidate: false, reason: 'UNCLASSIFIED' };
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[\",\n]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s;
}

async function run() {
  const snapshot = await master.run();
  const campaigns = snapshot.campaigns.map(row => {
    const c = classify(row);
    return {
      priority: PRIORITY[row.family] || 100,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      family: row.family,
      currentStatus: row.statusLabel,
      leadCount: row.leadCount,
      senderCount: row.senderCount,
      sequenceStepCount: row.sequenceStepCount,
      dailyLimit: row.dailyLimit,
      schedulePresent: row.schedulePresent,
      repliesObserved: row.replies,
      issues: row.issues,
      ...c
    };
  }).sort((a,b) => a.priority - b.priority || b.leadCount - a.leadCount || a.campaignName.localeCompare(b.campaignName));

  const activationCandidates = campaigns.filter(x => x.activationCandidate);
  const active = campaigns.filter(x => x.currentStatus === 'ACTIVE');
  const emptyDrafts = campaigns.filter(x => x.disposition === 'EMPTY_DRAFT_REVIEW');
  const repairs = campaigns.filter(x => x.disposition === 'REPAIR_CONFIGURATION');

  const result = {
    ok: true,
    gate: 'P1.5A_INSTANTLY_REVENUE_DEPLOYMENT_PLAN',
    generatedAt: new Date().toISOString(),
    sourceGate: snapshot.gate,
    truth: {
      campaignsObserved: campaigns.length,
      campaignMembershipsObserved: snapshot.totals.leadsObservedAcrossCampaignMemberships,
      activeCampaigns: active.length,
      governedReactivationCandidates: activationCandidates.length,
      emptyDrafts: emptyDrafts.length,
      configurationRepairs: repairs.length
    },
    operatingRules: {
      revenuePriorityOrder: ['EXPIRATION','GSA','VA','SAM','CERTIFICATION','SBS','STATE_SLED'],
      neverAutoActivateWithoutExplicitAuthorization: true,
      neverDeleteLeads: true,
      neverDeleteCampaigns: true,
      preserveSuppressionAndPipelineCampaigns: true,
      requireLeadsSequenceAndSenderBeforeActivation: true,
      requireFinalSenderCapacityAndHealthGateBeforeActivation: true,
      requireFinalLeadOverlapAndSuppressionGateBeforeActivation: true,
      requireMessageAndFollowUpReviewBeforeActivation: true
    },
    activationCandidates,
    activeCampaigns: active,
    emptyDrafts,
    configurationRepairs: repairs,
    campaigns,
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
  result.csvFile = CSV_FILE;
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

  const headers = ['priority','campaignId','campaignName','family','currentStatus','leadCount','senderCount','sequenceStepCount','dailyLimit','schedulePresent','repliesObserved','issues','disposition','activationCandidate','reason'];
  const lines = [headers.join(',')];
  for (const row of campaigns) {
    const x = {...row, issues: (row.issues || []).join(';')};
    lines.push(headers.map(h => csvEscape(x[h])).join(','));
  }
  fs.writeFileSync(CSV_FILE, lines.join('\n'));
  return result;
}

module.exports = { run, classify, PRIORITY };
