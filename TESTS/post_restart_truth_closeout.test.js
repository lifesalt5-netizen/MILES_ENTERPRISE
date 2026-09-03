'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const policyEngine = require('../SERVICES/governance/PolicyEngineService');
const HistoricalProspectFallbackService = require('../SERVICES/demo/HistoricalProspectFallbackService');
const DemoTruthReconciliationService = require('../SERVICES/demo/DemoTruthReconciliationService');
const identity = require('../SERVICES/demo/CompanyIdentityCanonicalizer');

// Regression: READ_SENDING_ACCOUNTS must not match the protected SEND action
// merely because SEND is a substring of SENDING.
const readAccounts = policyEngine.evaluate({
  provider: 'INSTANTLY',
  action: 'listAccounts',
  payload: {
    provider: 'INSTANTLY',
    action: 'listAccounts',
    capability: 'READ_SENDING_ACCOUNTS',
    objective: 'Refresh live Instantly sending-account inventory.'
  }
});
assert.notStrictEqual(readAccounts.decision, 'REQUIRE_APPROVAL');
assert.strictEqual(readAccounts.approvalRequired, false);
assert.notStrictEqual(String(readAccounts.matches?.structuredApprovalPattern || '').toUpperCase(), 'SEND');

// A real structured SEND must remain protected; this regression must never
// weaken outbound governance merely to clear the false listAccounts approval.
const realSend = policyEngine.evaluate({
  provider: 'INSTANTLY',
  action: 'SEND',
  payload: {
    provider: 'INSTANTLY',
    action: 'SEND',
    capability: 'SEND',
    objective: 'Send a campaign message.'
  }
});
assert.notStrictEqual(realSend.decision, 'ALLOW');
assert(
  realSend.approvalRequired === true || realSend.decision === 'DENY',
  'real SEND must remain approval-gated or denied'
);

// Command Center must always preserve pending CEO approvals in the dashboard
// snapshot even when they are older than the newest 50 historical operations.
const commandCenterSource = fs.readFileSync(
  path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js'),
  'utf8'
).replace(/^\uFEFF/, '');
assert(commandCenterSource.includes('function dashboardOperations(operations = [], limit = 50)'));
assert(commandCenterSource.includes("'AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL', 'AWAITING_CEO_APPROVAL'"));
assert(commandCenterSource.includes('const operations = dashboardOperations(queue.operations, 50);'));
assert(!commandCenterSource.includes('operations: queue.operations.slice(0, 50)'));

// Company identity formatting variants must converge without enabling broad
// fuzzy matching. Equivalent formatting maps to one canonical key; genuinely
// different names remain different until another authoritative ID corroborates.
const deLuneKey = identity.canonicalCompact('DeLune Corporation');
for (const variant of [
  'DeLune',
  'DE LUNE',
  'DE-LUNE',
  'DeLune Corp.',
  'DE LUNE CORPORATION',
  'de_lune, co.'
]) {
  assert.strictEqual(identity.canonicalCompact(variant), deLuneKey, `variant must resolve equivalently: ${variant}`);
}
assert.strictEqual(identity.canonicalCompact("O'Neill Technologies, L.L.C."), identity.canonicalCompact('ONeill Technologies LLC'));
assert.strictEqual(identity.canonicalCompact('Smith & Jones, Inc.'), identity.canonicalCompact('Smith and Jones Incorporated'));
assert.strictEqual(identity.canonicalCompact('Café Federal LLC'), identity.canonicalCompact('Cafe Federal, L.L.C.'));
assert.strictEqual(identity.canonicalCompact('Alpha/Beta Corp.'), identity.canonicalCompact('Alpha Beta Corporation'));
assert.notStrictEqual(identity.canonicalCompact('DeLune Corporation'), identity.canonicalCompact('Delaney Corporation'));
assert.notStrictEqual(identity.canonicalCompact('ABC Technologies'), identity.canonicalCompact('ABD Technologies'));

// Historical fallback must canonicalize common legal suffixes without ever
// turning a missing identity into a fabricated contractor match.
const { canonicalName } = HistoricalProspectFallbackService.helpers;
assert.strictEqual(canonicalName('DeLune Corporation'), 'DELUNE');
assert.strictEqual(canonicalName('GO Logistics Courier Services LLC'), 'GO LOGISTICS COURIER SERVICES');
assert.strictEqual(canonicalName('Integrated Technology Partners Corporation'), 'INTEGRATED TECHNOLOGY PARTNERS');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-post-restart-truth-'));
try {
  const historical = new HistoricalProspectFallbackService({ rootDir: tempRoot });
  const unresolved = historical.build('DeLune Corporation');
  assert.strictEqual(unresolved.ok, true);
  assert.strictEqual(unresolved.status, 'DEMO_READY_WITH_EXPLICIT_IDENTITY_COVERAGE_GAP');
  assert.strictEqual(unresolved.profile.uei, null);
  assert.strictEqual(unresolved.profile.cage, null);
  assert.strictEqual(unresolved.profile.samStatus, 'UNVERIFIED');
  assert.strictEqual(unresolved.currentState.samRegistration, null);
  assert.strictEqual(unresolved.currentState.activeContracts, null);
  assert.strictEqual(unresolved.revenue.current.federal, null);
  assert.strictEqual(unresolved.safety.contactsInvented, false);
  assert.strictEqual(unresolved.evidence.identity.status, 'UNRESOLVED');

  const reconciled = new DemoTruthReconciliationService().reconcile(unresolved);
  assert.strictEqual(reconciled.truthIntegrity.clientSafe, true);
  assert.deepStrictEqual(reconciled.truthIntegrity.conflicts, []);
  assert.strictEqual(reconciled.currentState.activeContracts, null);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// Successful ORION models are now rechecked against the governed current SAM
// qualified universe by UEI before truth reconciliation, and contractor-not-
// found models have a validated historical/explicit-coverage fallback.
const demoStartSource = fs.readFileSync(path.join(ROOT, 'StartP2GCGrowthBlueprintDemo.js'), 'utf8').replace(/^\uFEFF/, '');
assert(demoStartSource.includes('HistoricalProspectFallbackService'));
assert(demoStartSource.includes('historicalFallback.build(term'));
assert(demoStartSource.includes('const currentSam = samFallback.build(baseModel.profile.uei);'));
assert(demoStartSource.includes('currentSamRegistration'));

const blueprintSource = fs.readFileSync(
  path.join(ROOT, 'SERVICES', 'demo', 'ExecutiveGrowthBlueprintDemoService.js'),
  'utf8'
).replace(/^\uFEFF/, '');
assert(blueprintSource.includes('const samRegistrationState = samActive ? true : samExplicitInactive ? false : null;'));
assert(blueprintSource.includes('samStatus:samDisplayStatus'));
assert(blueprintSource.includes('samRegistration:samRegistrationState'));

console.log('POST_RESTART_TRUTH_CLOSEOUT=GREEN');
