'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateRules, validateManifest } = require('../SCRIPTS/ValidateAllSystemsGoManifest');

const root = path.resolve(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(root, 'DATA', 'governance', 'all_systems_go_acceptance_rules.json'), 'utf8'));

const ruleResult = validateRules(rules);
assert.strictEqual(ruleResult.ok, true, ruleResult.errors.join('\n'));
assert.strictEqual(rules.executionPrinciples?.primary, 'FASTEST_SAFE_EVIDENCE_BACKED_PATH_TO_VERIFIED_COMPLETION');
for (const required of [
  'AVOID_DUPLICATE_READS_TESTS_POLLS_AUDITS_BRANCHES_AND_MANUAL_CEO_STEPS',
  'PREFER_GOVERNED_AUTOMATION_OVER_CEO_SHELL_OR_PROVIDER_CONSOLE_WORK',
  'PARALLELIZE_INDEPENDENT_SAFE_WORKSTREAMS_WHEN_SHARED_STATE_AND_EVIDENCE_REMAIN_VALID'
]) {
  assert(rules.executionPrinciples.requirements.includes(required), `Missing fastest-path requirement ${required}`);
}
for (const boundary of [
  'SAFETY_BOUNDARIES',
  'AUTHORITATIVE_SOURCE_RECONCILIATION',
  'REQUIRED_PRODUCTION_PROOF',
  'FINAL_CURRENT_MAIN_REGRESSION'
]) {
  assert(rules.executionPrinciples.speedNeverOverrides.includes(boundary), `Speed must never override ${boundary}`);
}

const requiredIds = rules.requiredGates.map(g => g.id);
for (const id of [
  'MILES_CORE_RUNTIME',
  'INDEPENDENT_WATCHDOG_RECOVERY',
  'ORION_CORE_AND_FRESHNESS',
  'EXECUTIVE_DASHBOARD',
  'EXECUTIVE_DASHBOARD_TABS',
  'PROSPECT_DEMO',
  'SUB2PRIME',
  'OPPORTUNITY_INTELLIGENCE',
  'VEHICLE_INTELLIGENCE',
  'RECOMPETE_INTELLIGENCE',
  'PROPOSAL_COMMAND',
  'FINAL_CURRENT_MAIN_REGRESSION',
  'FINAL_ACCEPTANCE_MANIFEST'
]) {
  assert(requiredIds.includes(id), `Missing governed gate ${id}`);
}

const now = new Date().toISOString();
const sha = '0123456789abcdef0123456789abcdef01234567';
const criteria = Object.fromEntries(rules.systemGoCriteria.map(id => [id, { status: 'GREEN' }]));
const passingManifest = {
  standard: rules.standard,
  overallStatus: 'ALL_SYSTEMS_GO',
  generatedAt: now,
  currentMainSha: sha,
  acceptedProductionSha: sha,
  blockers: 0,
  unprovenCriticalGates: 0,
  mockOrDemoValuesPresentedAsProductionTruth: 0,
  unauthorizedMutations: 0,
  ceoManualRecoveryDependencies: 0,
  gates: rules.requiredGates.map(g => ({
    id: g.id,
    status: 'GREEN',
    observedAt: now,
    evidence: [{ source: `synthetic-contract-proof:${g.id}`, observedAt: now }],
    criteria: JSON.parse(JSON.stringify(criteria))
  }))
};

const pass = validateManifest(passingManifest, rules);
assert.strictEqual(pass.ok, true, pass.errors.join('\n'));

const notGreen = JSON.parse(JSON.stringify(passingManifest));
notGreen.gates.find(g => g.id === 'EXECUTIVE_DASHBOARD_TABS').status = 'WATCH';
assert.strictEqual(validateManifest(notGreen, rules).ok, false, 'WATCH dashboard tabs must block ALL SYSTEMS GO');

const missingEvidence = JSON.parse(JSON.stringify(passingManifest));
missingEvidence.gates.find(g => g.id === 'ORION_CORE_AND_FRESHNESS').evidence = [];
assert.strictEqual(validateManifest(missingEvidence, rules).ok, false, 'Missing evidence must block ALL SYSTEMS GO');

const manualRecovery = JSON.parse(JSON.stringify(passingManifest));
manualRecovery.ceoManualRecoveryDependencies = 1;
assert.strictEqual(validateManifest(manualRecovery, rules).ok, false, 'Manual CEO recovery dependency must block ALL SYSTEMS GO');

const mockTruth = JSON.parse(JSON.stringify(passingManifest));
mockTruth.mockOrDemoValuesPresentedAsProductionTruth = 1;
assert.strictEqual(validateManifest(mockTruth, rules).ok, false, 'Mock/demo-as-production truth must block ALL SYSTEMS GO');

const staleAcceptance = JSON.parse(JSON.stringify(passingManifest));
staleAcceptance.acceptedProductionSha = 'fedcba9876543210fedcba9876543210fedcba98';
assert.strictEqual(validateManifest(staleAcceptance, rules).ok, false, 'Production/current-main mismatch must block ALL SYSTEMS GO');

const invalidNa = JSON.parse(JSON.stringify(passingManifest));
invalidNa.gates[0].criteria.AUTONOMOUS_WHERE_APPLICABLE = { status: 'NOT_APPLICABLE_WITH_REASON' };
assert.strictEqual(validateManifest(invalidNa, rules).ok, false, 'N/A without reason must fail closed');

console.log('ALL_SYSTEMS_GO_ACCEPTANCE_STANDARD=PASS');
