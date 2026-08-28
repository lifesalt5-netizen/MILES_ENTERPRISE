'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const RULES_PATH = path.join(ROOT, 'DATA', 'governance', 'all_systems_go_acceptance_rules.json');
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'DATA', 'operational_acceptance', 'final', 'ALL_SYSTEMS_GO_MANIFEST.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateRules(rules) {
  const errors = [];
  if (!rules || rules.standard !== 'P2GC_MILES_ALL_SYSTEMS_GO') errors.push('RULE_STANDARD_INVALID');
  if (rules.status !== 'GOVERNING') errors.push('RULE_STATUS_NOT_GOVERNING');
  if (!Array.isArray(rules.systemGoCriteria) || rules.systemGoCriteria.length < 10) errors.push('SYSTEM_GO_CRITERIA_INCOMPLETE');
  if (!Array.isArray(rules.requiredGates) || rules.requiredGates.length === 0) errors.push('REQUIRED_GATES_MISSING');
  const gateIds = (rules.requiredGates || []).map(g => g && g.id).filter(Boolean);
  if (new Set(gateIds).size !== gateIds.length) errors.push('REQUIRED_GATE_IDS_NOT_UNIQUE');
  for (const required of ['EXECUTIVE_DASHBOARD', 'EXECUTIVE_DASHBOARD_TABS', 'ORION_CORE_AND_FRESHNESS', 'INDEPENDENT_WATCHDOG_RECOVERY', 'FINAL_CURRENT_MAIN_REGRESSION', 'FINAL_ACCEPTANCE_MANIFEST']) {
    if (!gateIds.includes(required)) errors.push(`REQUIRED_GATE_NOT_GOVERNED:${required}`);
  }
  return { ok: errors.length === 0, errors };
}

function validateCriterion(gateId, criterionId, value, allowedStatuses, errors) {
  if (!value || typeof value !== 'object') {
    errors.push(`CRITERION_MISSING:${gateId}:${criterionId}`);
    return;
  }
  if (!allowedStatuses.includes(value.status)) {
    errors.push(`CRITERION_STATUS_INVALID:${gateId}:${criterionId}:${value.status || 'MISSING'}`);
    return;
  }
  if (value.status === 'NOT_APPLICABLE_WITH_REASON' && !String(value.reason || '').trim()) {
    errors.push(`CRITERION_NA_REASON_MISSING:${gateId}:${criterionId}`);
  }
}

function validateManifest(manifest, rules) {
  const errors = [];
  const ruleCheck = validateRules(rules);
  errors.push(...ruleCheck.errors);

  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: [...errors, 'MANIFEST_INVALID'] };
  if (manifest.standard !== rules.standard) errors.push('MANIFEST_STANDARD_MISMATCH');
  if (manifest.overallStatus !== rules.finalDeclaration.requiredOverallStatus) errors.push(`OVERALL_STATUS_NOT_ALL_SYSTEMS_GO:${manifest.overallStatus || 'MISSING'}`);
  if (!isIsoDate(manifest.generatedAt)) errors.push('MANIFEST_GENERATED_AT_INVALID');

  const requiredZeroFields = [
    'blockers',
    'unprovenCriticalGates',
    'mockOrDemoValuesPresentedAsProductionTruth',
    'unauthorizedMutations',
    'ceoManualRecoveryDependencies'
  ];
  for (const field of requiredZeroFields) {
    if (Number(manifest[field]) !== 0) errors.push(`FINAL_ZERO_INVARIANT_FAILED:${field}:${manifest[field]}`);
  }

  if (!String(manifest.currentMainSha || '').trim()) errors.push('CURRENT_MAIN_SHA_MISSING');
  if (!String(manifest.acceptedProductionSha || '').trim()) errors.push('ACCEPTED_PRODUCTION_SHA_MISSING');
  if (manifest.currentMainSha && manifest.acceptedProductionSha && manifest.currentMainSha !== manifest.acceptedProductionSha) {
    errors.push(`CURRENT_MAIN_PRODUCTION_SHA_MISMATCH:${manifest.currentMainSha}:${manifest.acceptedProductionSha}`);
  }

  const gates = Array.isArray(manifest.gates) ? manifest.gates : [];
  const byId = new Map(gates.filter(Boolean).map(g => [g.id, g]));
  const allowedCriterionStatuses = rules.allowedCriterionStatuses || ['GREEN', 'NOT_APPLICABLE_WITH_REASON'];

  for (const ruleGate of rules.requiredGates || []) {
    const gate = byId.get(ruleGate.id);
    if (!gate) {
      errors.push(`REQUIRED_GATE_MISSING:${ruleGate.id}`);
      continue;
    }
    if (gate.status !== rules.finalDeclaration.requiredGateStatus) errors.push(`GATE_NOT_GREEN:${ruleGate.id}:${gate.status || 'MISSING'}`);
    if (!isIsoDate(gate.observedAt)) errors.push(`GATE_OBSERVED_AT_INVALID:${ruleGate.id}`);
    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) errors.push(`GATE_EVIDENCE_MISSING:${ruleGate.id}`);
    else {
      gate.evidence.forEach((evidence, index) => {
        if (!evidence || typeof evidence !== 'object' || !String(evidence.source || '').trim()) errors.push(`GATE_EVIDENCE_SOURCE_MISSING:${ruleGate.id}:${index}`);
        if (!evidence || !isIsoDate(evidence.observedAt)) errors.push(`GATE_EVIDENCE_TIME_INVALID:${ruleGate.id}:${index}`);
      });
    }
    const criteria = gate.criteria && typeof gate.criteria === 'object' ? gate.criteria : {};
    for (const criterionId of rules.systemGoCriteria || []) validateCriterion(ruleGate.id, criterionId, criteria[criterionId], allowedCriterionStatuses, errors);
  }

  const unexpectedRedOrWatch = gates.filter(g => g && ['RED', 'WATCH', 'YELLOW', 'UNKNOWN', 'PENDING', 'UNPROVEN'].includes(String(g.status || '').toUpperCase()));
  if (unexpectedRedOrWatch.length) errors.push(`NON_GREEN_GATES_PRESENT:${unexpectedRedOrWatch.map(g => g.id).join(',')}`);

  return { ok: errors.length === 0, errors };
}

function run(manifestPath = process.argv[2] || DEFAULT_MANIFEST_PATH) {
  if (!fs.existsSync(RULES_PATH)) {
    console.error('ALL_SYSTEMS_GO_RULES_MISSING');
    process.exitCode = 2;
    return;
  }
  const rules = readJson(RULES_PATH);
  const ruleCheck = validateRules(rules);
  if (!ruleCheck.ok) {
    console.error(JSON.stringify({ ok: false, status: 'ALL_SYSTEMS_GO_RULES_RED', errors: ruleCheck.errors }, null, 2));
    process.exitCode = 2;
    return;
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(JSON.stringify({ ok: false, status: 'NOT_ALL_SYSTEMS_GO', errors: ['FINAL_MANIFEST_MISSING'], manifestPath }, null, 2));
    process.exitCode = 2;
    return;
  }
  const manifest = readJson(manifestPath);
  const result = validateManifest(manifest, rules);
  console.log(JSON.stringify({ ...result, status: result.ok ? 'ALL_SYSTEMS_GO_VALIDATED' : 'NOT_ALL_SYSTEMS_GO', manifestPath }, null, 2));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) run();

module.exports = { validateRules, validateManifest, run };
