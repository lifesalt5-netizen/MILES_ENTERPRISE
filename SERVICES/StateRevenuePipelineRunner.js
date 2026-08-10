'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RULES = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'CONFIG', 'state_revenue_pipeline_runner_rules.json'),
    'utf8'
  )
);

function safeRequire(rel) {
  try {
    return { ok: true, module: require(rel) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function invoke(name, rel, options = {}) {
  const loaded = safeRequire(rel);
  if (!loaded.ok) {
    return { name, status: 'MISSING', ok: false, error: loaded.error };
  }

  const mod = loaded.module;
  const fn = typeof mod.run === 'function' ? mod.run.bind(mod) : null;
  if (!fn) {
    return { name, status: 'UNSUPPORTED', ok: false, error: 'run() not exposed' };
  }

  try {
    const result = await fn(options);
    return { name, status: 'PASS', ok: result?.ok !== false, result };
  } catch (error) {
    return { name, status: 'FAILED', ok: false, error: error.message };
  }
}

function approvalState() {
  return {
    paidVerificationSpendAuthorized:
      process.env.MILES_STATE_PIPELINE_PAID_VERIFICATION_AUTH ===
      'AUTHORIZE_STATE_PIPELINE_PAID_VERIFICATION',
    campaignMutationAuthorized:
      process.env.MILES_STATE_PIPELINE_CAMPAIGN_MUTATION_AUTH ===
      'AUTHORIZE_STATE_PIPELINE_CAMPAIGN_MUTATIONS',
    liveReplySendAuthorized:
      process.env.MILES_STATE_PIPELINE_REPLY_SEND_AUTH ===
      'AUTHORIZE_STATE_PIPELINE_REPLY_SEND',
    calendarWriteAuthorized:
      process.env.MILES_STATE_PIPELINE_CALENDAR_WRITE_AUTH ===
      'AUTHORIZE_STATE_PIPELINE_CALENDAR_WRITE'
  };
}

async function run(options = {}) {
  const states = Array.isArray(options.states) && options.states.length
    ? options.states
    : RULES.states;

  const approvals = approvalState();
  const steps = [];

  // Reuse accepted production services. Every service remains responsible
  // for its own detailed safety checks; this runner only orchestrates them.
  steps.push(await invoke('SEGMENT', './StateSledSegmentationService'));
  steps.push(await invoke('BUILD_ENRICHMENT_QUEUE', './StateSledEnrichmentQueueService'));

  if (approvals.paidVerificationSpendAuthorized || options.allowVerificationReadinessOnly === true) {
    steps.push(await invoke(
      'DISCOVER_VERIFY_EMAILS',
      './StateSledEmailDiscoveryService',
      { states, batchSize: Number(options.batchSize || RULES.batchSize) }
    ));
  } else {
    steps.push({
      name: 'DISCOVER_VERIFY_EMAILS',
      status: 'AWAITING_APPROVAL',
      ok: true,
      approvalRequired: 'PAID_VERIFICATION_SPEND'
    });
  }

  steps.push(await invoke('BUILD_VERIFIED_MASTER', './StateSledVerifiedMasterReconciliationService'));
  steps.push(await invoke('PREPARE_CAMPAIGN_PLAN', './StateSledCampaignPlanService'));
  steps.push(await invoke('PREPARE_EXECUTION_PACKAGES', './StateSledExecutionPackageService'));

  // Live reply / CRM layers are safe to read even when campaign mutation is not authorized.
  steps.push(await invoke('READ_REPLIES', './StateSledFlReplyClassificationRoutingService'));
  steps.push(await invoke('PLAN_CRM_ROUTING', './StateSledFlReplyToCrmRoutingService'));
  steps.push(await invoke('PLAN_MEETING_ROUTING', './StateSledFlCalendlyMeetingRoutingService'));

  const blockers = steps.filter(s => s.status === 'FAILED' || s.status === 'MISSING');
  const awaitingApproval = steps.filter(s => s.status === 'AWAITING_APPROVAL');

  const summary = {
    ok: blockers.length === 0,
    gate: RULES.gate,
    version: RULES.version,
    generatedAt: new Date().toISOString(),
    states,
    approvals,
    steps: steps.map(s => ({
      name: s.name,
      status: s.status,
      ok: s.ok,
      approvalRequired: s.approvalRequired || null,
      error: s.error || null
    })),
    blockers,
    awaitingApproval,
    readyToContinueAutomatically: blockers.length === 0,
    nextHumanBoundary:
      awaitingApproval[0]?.approvalRequired ||
      null,
    safety: RULES.safety
  };

  const outDir = path.join(ROOT, 'DATA', 'OUTBOUND', 'STATE_SLED', 'PIPELINE_RUNNER');
  fs.mkdirSync(outDir, { recursive: true });
  const outputFile = path.join(outDir, 'STATE_REVENUE_PIPELINE_LATEST.json');
  fs.writeFileSync(outputFile, JSON.stringify({ summary, steps }, null, 2));
  summary.outputFile = outputFile;

  return summary;
}

module.exports = { run, approvalState };
