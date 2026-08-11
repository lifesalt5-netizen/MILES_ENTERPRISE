'use strict';

/*
  MILES Enterprise
  P1.5F — Post-repair verification + governed first-batch activation
  Rebuilds dedup/sender truth and message readiness after P1.5E.
  It will not activate while unresolved priority overlap remains.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const dedupGate = require('./InstantlyRevenuePriorityDedupSenderCapacityGateService');
const messageGate = require('./InstantlyRevenueMessageActivationGateService');
const connector = require('../CONNECTORS/INSTANTLY/connector');

const ROOT = process.cwd();
const P1_5E_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_DEDUP_CONFIG_REPAIR_LATEST.json');
const OUTPUT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_POST_REPAIR_FIRST_BATCH_ACTIVATION_LATEST.json');
const AUTH_TOKEN = 'AUTHORIZE_P1_5F_FIRST_BATCH_ACTIVATION';

function loadJson(file) {
  if (!fs.existsSync(file)) throw new Error(`Required artifact not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function activateCampaign(campaignId) {
  return connector.execute({ action: 'activateCampaign', payload: { campaign_id: campaignId, id: campaignId } });
}

async function run(options = {}) {
  const executeLive = options.executeLive === true || String(process.env.MILES_P1_5F_LIVE || '').toLowerCase() === 'true';
  const authorization = String(options.authorization || process.env.MILES_P1_5F_AUTH || '').trim();

  const repair = loadJson(P1_5E_FILE);

  // Rebuild P1.5C from live Instantly state after dedup/config repair.
  const c = await dedupGate.run();
  // P1.5D consumes the newly-written P1.5C artifact.
  const d = await messageGate.run();

  const remainingOverlap = Number(c?.totals?.blockedActiveAcquisition || 0) + Number(c?.totals?.blockedCandidateOverlap || 0);
  const remainingSuppression = Number(c?.totals?.blockedSuppression || 0);
  const deferredBusyFromRepair = Number(repair?.dedupContactsDeferredBusy || 0);

  const candidateById = new Map((d.candidates || []).map(x => [x.campaignId, x]));
  const firstBatch = (d.recommendedFirstBatch || []).map(x => candidateById.get(x.campaignId) || x);

  const globalBlockers = [];
  if (remainingSuppression > 0) globalBlockers.push('SUPPRESSION_MEMBERSHIPS_STILL_PRESENT_IN_ACTIVATION_CANDIDATES');
  if (remainingOverlap > 0) globalBlockers.push('PRIORITY_OVERLAP_STILL_PRESENT');
  if (deferredBusyFromRepair > 0 && remainingOverlap > 0) globalBlockers.push('P1_5E_DEDUP_BACKGROUND_JOBS_NOT_FULLY_SETTLED');
  if (!firstBatch.length) globalBlockers.push('NO_READY_FIRST_BATCH');

  const activationAuthorized = authorization === AUTH_TOKEN && executeLive;
  const activationResults = [];

  if (activationAuthorized && globalBlockers.length === 0) {
    for (const row of firstBatch.slice(0, 3)) {
      const blockers = Array.isArray(row.blockers) ? row.blockers : [];
      if (!row.readyForGovernedActivationAuthorization || blockers.length) {
        activationResults.push({ campaignId: row.campaignId, campaignName: row.campaignName, activated: false, reason: 'CANDIDATE_NOT_READY' });
        continue;
      }
      const response = await activateCampaign(row.campaignId);
      activationResults.push({ campaignId: row.campaignId, campaignName: row.campaignName, activated: true, responseObserved: Boolean(response) });
    }
  }

  const result = {
    ok: true,
    gate: 'P1.5F_POST_REPAIR_RECONCILIATION_AND_FIRST_BATCH_ACTIVATION',
    generatedAt: new Date().toISOString(),
    postRepairTruth: {
      activationCandidates: Number(c?.totals?.activationCandidates || 0),
      eligibleContacts: Number(c?.totals?.eligibleContacts || 0),
      blockedSuppression: Number(c?.totals?.blockedSuppression || 0),
      blockedActiveAcquisition: Number(c?.totals?.blockedActiveAcquisition || 0),
      blockedCandidateOverlap: Number(c?.totals?.blockedCandidateOverlap || 0),
      campaignsReadyForMessageAndActivationGate: Number(c?.totals?.campaignsReadyForMessageAndActivationGate || 0),
      messageGateCandidates: Number(d?.totals?.candidates || 0),
      messageGateReady: Number(d?.totals?.readyForGovernedActivationAuthorization || 0),
      messageGateBlocked: Number(d?.totals?.blocked || 0)
    },
    priorRepair: {
      duplicateMembershipsToRemove: Number(repair?.duplicateMembershipsToRemove || 0),
      dedupContactsRequested: Number(repair?.dedupContactsRequested || 0),
      dedupContactsDeferredBusy: deferredBusyFromRepair,
      configRepairsExecuted: Number(repair?.configRepairsExecuted || 0)
    },
    firstBatch: firstBatch.slice(0, 3).map(x => ({
      campaignId: x.campaignId,
      campaignName: x.campaignName,
      family: x.family,
      eligibleUniqueContacts: x.eligibleUniqueContacts,
      blockers: x.blockers || [],
      warnings: x.warnings || [],
      readyForGovernedActivationAuthorization: Boolean(x.readyForGovernedActivationAuthorization)
    })),
    globalBlockers,
    activationAuthorized,
    activationAttempted: activationAuthorized && globalBlockers.length === 0,
    activationResults,
    nextAction: globalBlockers.includes('PRIORITY_OVERLAP_STILL_PRESENT')
      ? 'RERUN_P1_5E_EXACT_DEDUP_AFTER_BACKGROUND_JOBS_CLEAR'
      : activationResults.length > 0
        ? 'VERIFY_FIRST_BATCH_LIVE_AND_MONITOR'
        : 'AUTHORIZE_FIRST_BATCH_ACTIVATION',
    safety: {
      maxCampaignsActivatedThisRun: 3,
      activationRequiresExactAuthorization: true,
      noActivationWhilePriorityOverlapRemains: true,
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
