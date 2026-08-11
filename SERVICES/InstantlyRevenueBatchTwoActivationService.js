'use strict';

/*
  MILES Enterprise
  P1.5H — Governed Batch 2 activation
  Rebuilds live dedup + message readiness after Batch 1 is active,
  selects the next three remaining ready campaigns, activates only with
  explicit authorization, and verifies live ACTIVE status after mutation.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const dedupGate = require('./InstantlyRevenuePriorityDedupSenderCapacityGateService');
const messageGate = require('./InstantlyRevenueMessageActivationGateService');
const connector = require('../CONNECTORS/INSTANTLY/connector');

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_BATCH_TWO_ACTIVATION_LATEST.json');
const AUTH_TOKEN = 'AUTHORIZE_P1_5H_BATCH_TWO_ACTIVATION';

async function activateCampaign(campaignId) {
  return connector.execute({ action: 'activateCampaign', payload: { campaign_id: campaignId, id: campaignId } });
}

async function readCampaign(campaignId) {
  const r = await connector.execute({ action: 'getCampaign', payload: { campaign_id: campaignId, id: campaignId } });
  return r?.campaign || r?.result || r || null;
}

function statusOf(campaign) {
  return campaign?.status ?? campaign?.campaign_status ?? campaign?.state ?? null;
}

async function run(options = {}) {
  const executeLive = options.executeLive === true || String(process.env.MILES_P1_5H_LIVE || '').toLowerCase() === 'true';
  const authorization = String(options.authorization || process.env.MILES_P1_5H_AUTH || '').trim();

  const c = await dedupGate.run();
  const d = await messageGate.run();

  const remainingSuppression = Number(c?.totals?.blockedSuppression || 0);
  const remainingOverlap = Number(c?.totals?.blockedActiveAcquisition || 0) + Number(c?.totals?.blockedCandidateOverlap || 0);

  const ready = (d.candidates || [])
    .filter(x => x.readyForGovernedActivationAuthorization && !(x.blockers || []).length)
    .sort((a,b) => Number(a.priority||999)-Number(b.priority||999) || Number(b.eligibleUniqueContacts||0)-Number(a.eligibleUniqueContacts||0) || String(a.campaignName).localeCompare(String(b.campaignName)));

  const batch = ready.slice(0, 3);
  const globalBlockers = [];
  if (remainingSuppression > 0) globalBlockers.push('SUPPRESSION_MEMBERSHIPS_STILL_PRESENT');
  if (remainingOverlap > 0) globalBlockers.push('PRIORITY_OVERLAP_STILL_PRESENT');
  if (!batch.length) globalBlockers.push('NO_READY_BATCH_TWO_CAMPAIGNS');

  const activationAuthorized = authorization === AUTH_TOKEN && executeLive;
  const activationResults = [];

  if (activationAuthorized && globalBlockers.length === 0) {
    for (const row of batch) {
      let response = null;
      let mutationExecuted = false;
      let liveStatusVerified = false;
      let observedStatus = null;
      let reason = null;

      try {
        response = await activateCampaign(row.campaignId);
        const dryRun = response?.dryRun === true || response?.result?.dryRun === true;
        const explicitNotExecuted = response?.mutationExecuted === false || response?.result?.mutationExecuted === false;
        mutationExecuted = !dryRun && !explicitNotExecuted;
        if (!mutationExecuted) reason = 'INSTANTLY_MUTATION_NOT_EXECUTED';

        const live = await readCampaign(row.campaignId);
        observedStatus = statusOf(live);
        liveStatusVerified = Number(observedStatus) === 1 || String(observedStatus).toUpperCase() === 'ACTIVE';
        if (!liveStatusVerified && !reason) reason = 'LIVE_STATUS_NOT_ACTIVE_AFTER_ACTIVATION';
      } catch (e) {
        reason = e.message;
      }

      activationResults.push({
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        family: row.family,
        eligibleUniqueContacts: row.eligibleUniqueContacts,
        activated: mutationExecuted && liveStatusVerified,
        mutationExecuted,
        liveStatusVerified,
        observedStatus,
        responseObserved: Boolean(response),
        reason
      });
    }
  }

  const liveActivatedCount = activationResults.filter(x => x.activated).length;
  const result = {
    ok: true,
    gate: 'P1.5H_GOVERNED_BATCH_TWO_ACTIVATION',
    version: '1.0-live-mutation-and-status-verification',
    generatedAt: new Date().toISOString(),
    liveTruth: {
      activationCandidatesRemaining: Number(c?.totals?.activationCandidates || 0),
      eligibleContactsRemaining: Number(c?.totals?.eligibleContacts || 0),
      blockedSuppression: Number(c?.totals?.blockedSuppression || 0),
      blockedActiveAcquisition: Number(c?.totals?.blockedActiveAcquisition || 0),
      blockedCandidateOverlap: Number(c?.totals?.blockedCandidateOverlap || 0),
      messageGateCandidates: Number(d?.totals?.candidates || 0),
      messageGateReady: Number(d?.totals?.readyForGovernedActivationAuthorization || 0),
      messageGateBlocked: Number(d?.totals?.blocked || 0)
    },
    batchTwo: batch.map(x => ({
      campaignId: x.campaignId,
      campaignName: x.campaignName,
      family: x.family,
      eligibleUniqueContacts: x.eligibleUniqueContacts,
      senderEmails: x.senderEmails,
      warnings: x.warnings || [],
      blockers: x.blockers || []
    })),
    globalBlockers,
    activationAuthorized,
    activationAttempted: activationAuthorized && globalBlockers.length === 0,
    liveActivatedCount,
    activationResults,
    nextAction: liveActivatedCount === batch.length && batch.length > 0
      ? 'VERIFY_BATCH_TWO_LIVE_AND_MONITOR'
      : globalBlockers.length
        ? 'RESOLVE_BATCH_TWO_BLOCKERS'
        : 'REVIEW_BATCH_TWO_ACTIVATION_FAILURES',
    safety: {
      maxCampaignsActivatedThisRun: 3,
      activationRequiresExactAuthorization: true,
      noActivationWhilePriorityOverlapRemains: true,
      noActivationWhileSuppressionConflictsRemain: true,
      dryRunResponsesNeverCountAsActivation: true,
      liveStatusVerificationRequired: true,
      deleteLeads: false,
      deleteCampaigns: false,
      sendReplies: false
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  result.outputFile = OUTPUT_FILE;
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run };
