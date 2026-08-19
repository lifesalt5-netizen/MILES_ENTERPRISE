'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const master = require('./MasterInstantlyRevenueReconciliationService');
const plan = require('./InstantlyRevenueDeploymentPlanService');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'INSTANTLY_REVENUE_OVERLAP_SUPPRESSION_GATE_LATEST.json');

function emailOf(lead) {
  return String(lead?.email || lead?.email_address || '').trim().toLowerCase();
}

async function getCampaignLeadEmails(connector, campaignId) {
  const leads = await master.readAllCampaignLeads(connector, campaignId);
  return Array.from(new Set(leads.map(emailOf).filter(Boolean)));
}

async function run() {
  const connector = require('../CONNECTORS/INSTANTLY/connector');
  const p = await plan.run();
  const all = p.campaigns || [];
  const candidates = p.activationCandidates || [];
  const activeAcquisition = all.filter(x => x.currentStatus === 'ACTIVE' && !['SUPPRESSION','PIPELINE','MEETING_PIPELINE','NURTURE','FOLLOW_UP'].includes(x.family));
  const suppressionRows = all.filter(x => x.family === 'SUPPRESSION');

  const suppression = new Set();
  const suppressionByCampaign = {};
  for (const row of suppressionRows) {
    const emails = await getCampaignLeadEmails(connector, row.campaignId);
    suppressionByCampaign[row.campaignName] = emails.length;
    emails.forEach(e => suppression.add(e));
  }

  const activeMembership = new Map();
  for (const row of activeAcquisition) {
    const emails = await getCampaignLeadEmails(connector, row.campaignId);
    for (const email of emails) {
      if (!activeMembership.has(email)) activeMembership.set(email, []);
      activeMembership.get(email).push({campaignId: row.campaignId, campaignName: row.campaignName, family: row.family});
    }
  }

  const candidateEmailSets = new Map();
  for (const row of candidates) {
    candidateEmailSets.set(row.campaignId, new Set(await getCampaignLeadEmails(connector, row.campaignId)));
  }

  const rows = [];
  for (const row of candidates) {
    const set = candidateEmailSets.get(row.campaignId) || new Set();
    let suppressed = 0;
    let overlapsActive = 0;
    const overlappingActiveCampaigns = new Map();
    for (const email of set) {
      if (suppression.has(email)) suppressed += 1;
      const activeHits = activeMembership.get(email) || [];
      if (activeHits.length) {
        overlapsActive += 1;
        for (const hit of activeHits) overlappingActiveCampaigns.set(hit.campaignId, hit.campaignName);
      }
    }

    let overlapsOtherCandidates = 0;
    const overlappingCandidateCampaigns = [];
    for (const other of candidates) {
      if (other.campaignId === row.campaignId) continue;
      const otherSet = candidateEmailSets.get(other.campaignId) || new Set();
      let shared = 0;
      const iterate = set.size <= otherSet.size ? set : otherSet;
      const lookup = set.size <= otherSet.size ? otherSet : set;
      for (const email of iterate) if (lookup.has(email)) shared += 1;
      if (shared > 0) {
        overlapsOtherCandidates += shared;
        overlappingCandidateCampaigns.push({campaignId: other.campaignId, campaignName: other.campaignName, sharedContacts: shared});
      }
    }

    const cleanContacts = Math.max(0, set.size - suppressed - overlapsActive);
    const hardBlocked = suppressed > 0 || overlapsActive > 0;
    rows.push({
      priority: row.priority,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      family: row.family,
      leadCountObserved: set.size,
      suppressedContacts: suppressed,
      overlapWithActiveAcquisition: overlapsActive,
      overlappingActiveCampaigns: Array.from(overlappingActiveCampaigns.entries()).map(([campaignId,campaignName]) => ({campaignId,campaignName})),
      aggregateOverlapWithOtherCandidates: overlapsOtherCandidates,
      overlappingCandidateCampaigns,
      cleanContactsBeforeCandidatePriorityDedup: cleanContacts,
      hardBlockedUntilSuppressionAndActiveOverlapResolved: hardBlocked,
      readyForPriorityDedupPlanning: !hardBlocked
    });
  }

  const pairKeys = new Set();
  const overlapPairs = [];
  for (const row of rows) {
    for (const hit of row.overlappingCandidateCampaigns) {
      const ids = [row.campaignId, hit.campaignId].sort();
      const key = ids.join('|');
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);
      const left = rows.find(x => x.campaignId === ids[0]);
      const right = rows.find(x => x.campaignId === ids[1]);
      overlapPairs.push({
        campaignA: left ? left.campaignName : ids[0],
        campaignB: right ? right.campaignName : ids[1],
        sharedContacts: hit.sharedContacts
      });
    }
  }

  const result = {
    ok: true,
    gate: 'P1.5B_INSTANTLY_REVENUE_OVERLAP_SUPPRESSION_GATE',
    generatedAt: new Date().toISOString(),
    totals: {
      activationCandidates: candidates.length,
      suppressionContacts: suppression.size,
      candidatesWithSuppressedContacts: rows.filter(x => x.suppressedContacts > 0).length,
      candidatesOverlappingActiveAcquisition: rows.filter(x => x.overlapWithActiveAcquisition > 0).length,
      candidateOverlapPairs: overlapPairs.length,
      hardBlockedCandidates: rows.filter(x => x.hardBlockedUntilSuppressionAndActiveOverlapResolved).length
    },
    suppressionByCampaign,
    overlapPairs,
    candidates: rows,
    policy: {
      neverSendSuppressedContacts: true,
      doNotReactivateContactsAlreadyInActiveAcquisitionCampaign: true,
      resolveCandidateToCandidateOverlapByRevenuePriorityBeforeActivation: true,
      priorityOrder: p.operatingRules?.revenuePriorityOrder || []
    },
    readyForPriorityDedupPlanning: rows.every(x => !x.hardBlockedUntilSuppressionAndActiveOverlapResolved),
    safety: {
      readOnly: true,
      activateCampaigns: false,
      pauseCampaigns: false,
      moveLeads: false,
      deleteLeads: false,
      uploadLeads: false,
      sendReplies: false
    }
  };

  fs.mkdirSync(OUTPUT_DIR, {recursive:true});
  result.outputFile = OUTPUT_FILE;
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run };
