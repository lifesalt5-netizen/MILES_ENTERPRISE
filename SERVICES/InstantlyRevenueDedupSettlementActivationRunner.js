'use strict';

/*
  MILES Enterprise
  P1.5F2 — Dedup settlement poller + governed first-batch activation handoff
  Avoids repeatedly submitting duplicate move jobs while Instantly background jobs settle.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const dedupGate = require('./InstantlyRevenuePriorityDedupSenderCapacityGateService');
const firstBatch = require('./InstantlyRevenuePostRepairFirstBatchActivationService');

const ROOT = process.cwd();
const OUTPUT_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'INSTANTLY_REVENUE_DEDUP_SETTLEMENT_ACTIVATION_LATEST.json');
const AUTH_TOKEN = 'AUTHORIZE_P1_5F2_SETTLEMENT_AND_FIRST_BATCH';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function run(options = {}) {
  const authorization = String(options.authorization || process.env.MILES_P1_5F2_AUTH || '').trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_P1_5F2_LIVE || '').toLowerCase() === 'true';
  const pollSeconds = Math.max(10, Number(options.pollSeconds || 20));
  const maxPolls = Math.max(1, Math.min(60, Number(options.maxPolls || 30)));

  if (authorization !== AUTH_TOKEN) throw new Error('P1.5F2 authorization token missing or incorrect.');
  if (!executeLive) throw new Error('P1.5F2 live flag is not enabled.');

  const polls = [];
  let settled = false;
  let latest = null;

  for (let i = 1; i <= maxPolls; i += 1) {
    latest = await dedupGate.run();
    const blockedActive = Number(latest?.totals?.blockedActiveAcquisition || 0);
    const blockedCandidate = Number(latest?.totals?.blockedCandidateOverlap || 0);
    const blockedSuppression = Number(latest?.totals?.blockedSuppression || 0);
    const remainingOverlap = blockedActive + blockedCandidate;

    const row = {
      poll: i,
      at: new Date().toISOString(),
      blockedActiveAcquisition: blockedActive,
      blockedCandidateOverlap: blockedCandidate,
      blockedSuppression,
      remainingOverlap
    };
    polls.push(row);
    console.log(`[P1.5F2] poll ${i}/${maxPolls}: overlap=${remainingOverlap} active=${blockedActive} candidate=${blockedCandidate} suppression=${blockedSuppression}`);

    if (remainingOverlap === 0 && blockedSuppression === 0) {
      settled = true;
      break;
    }

    if (i < maxPolls) await sleep(pollSeconds * 1000);
  }

  let activationResult = null;
  if (settled) {
    process.env.MILES_P1_5F_AUTH = 'AUTHORIZE_P1_5F_FIRST_BATCH_ACTIVATION';
    process.env.MILES_P1_5F_LIVE = 'true';
    activationResult = await firstBatch.run({
      executeLive: true,
      authorization: 'AUTHORIZE_P1_5F_FIRST_BATCH_ACTIVATION'
    });
  }

  const result = {
    ok: true,
    gate: 'P1.5F2_DEDUP_SETTLEMENT_AND_FIRST_BATCH_ACTIVATION',
    generatedAt: new Date().toISOString(),
    settled,
    polls,
    finalTruth: latest ? {
      blockedActiveAcquisition: Number(latest?.totals?.blockedActiveAcquisition || 0),
      blockedCandidateOverlap: Number(latest?.totals?.blockedCandidateOverlap || 0),
      blockedSuppression: Number(latest?.totals?.blockedSuppression || 0),
      eligibleContacts: Number(latest?.totals?.eligibleContacts || 0),
      activationCandidates: Number(latest?.totals?.activationCandidates || 0)
    } : null,
    activationAttempted: Boolean(activationResult?.activationAttempted),
    activationResults: activationResult?.activationResults || [],
    activationGlobalBlockers: activationResult?.globalBlockers || [],
    nextAction: settled
      ? (activationResult?.activationResults?.length ? 'VERIFY_FIRST_BATCH_LIVE_AND_MONITOR' : 'REVIEW_ACTIVATION_RESULT')
      : 'INSTANTLY_BACKGROUND_DEDUP_STILL_SETTLING_DO_NOT_RESUBMIT_MOVE_JOBS',
    safety: {
      noDedupMutationSubmittedByThisRunner: true,
      activationOnlyAfterZeroPriorityOverlap: true,
      maxCampaignsActivated: 3,
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
