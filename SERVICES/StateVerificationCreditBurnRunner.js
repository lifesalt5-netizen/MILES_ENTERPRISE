'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const discovery = require('./StateSledEmailDiscoveryService');

const ROOT = process.cwd();
const RULES = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'CONFIG', 'state_verification_credit_burn_rules.json'),
    'utf8'
  )
);

function isAuthorized() {
  return process.env[RULES.authorizationEnv] === RULES.authorizationToken;
}

async function run(options = {}) {
  if (!isAuthorized()) {
    return {
      ok: false,
      gate: RULES.gate,
      status: 'AWAITING_APPROVAL',
      requiredAuthorization: RULES.authorizationToken,
      creditsUsed: 0,
      creditsRemaining: Number(options.creditBudget || RULES.defaultCreditBudget)
    };
  }

  const budget = Math.max(1, Number(options.creditBudget || RULES.defaultCreditBudget));
  const maxBatchRows = Math.max(1, Number(options.maxBatchRows || RULES.maxBatchRows));
  let creditsUsed = 0;
  let rowsProcessed = 0;
  let batchesRun = 0;
  let queueComplete = false;
  const batches = [];

  while (creditsUsed < budget && !queueComplete) {
    const remaining = budget - creditsUsed;
    const rowLimit = Math.max(1, Math.min(maxBatchRows, remaining));

    const result = await discovery.run({ limit: rowLimit });
    const stats = result?.stats || {};

    if (stats.millionVerifierConfigured !== true) {
      throw new Error('MillionVerifier is not configured; credit-burn runner stopped before counting any unverified batch as spend.');
    }

    const attempted = Number(stats.publicEmailsDiscovered || 0);

    creditsUsed += attempted;
    rowsProcessed += Number(stats.processed || 0);
    batchesRun += 1;
    queueComplete = Number(stats.remainingInQueue || 0) <= 0;

    batches.push({
      batchNumber: stats.batchNumber || batchesRun,
      offset: stats.offset || 0,
      processed: Number(stats.processed || 0),
      verificationCreditsUsed: attempted,
      verifiedOk: Number(stats.verifiedOk || 0),
      review: Number(stats.verificationReview || 0),
      rejected: Number(stats.verificationRejected || 0),
      remainingInQueue: Number(stats.remainingInQueue || 0)
    });

    if (Number(stats.processed || 0) === 0) break;
  }

  const summary = {
    ok: true,
    gate: RULES.gate,
    version: RULES.version,
    generatedAt: new Date().toISOString(),
    creditBudget: budget,
    creditsUsed,
    creditsRemaining: Math.max(0, budget - creditsUsed),
    hardStopReached: creditsUsed >= budget,
    queueComplete,
    rowsProcessed,
    batchesRun,
    batches,
    safety: RULES.safety
  };

  const outDir = path.join(ROOT, RULES.outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_VERIFICATION_CREDIT_BURN_LATEST.json');
  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));
  summary.outputFile = outputFile;

  return summary;
}

module.exports = { run, isAuthorized };
