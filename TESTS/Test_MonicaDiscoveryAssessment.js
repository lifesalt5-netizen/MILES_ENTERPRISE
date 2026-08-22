'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'CONFIG', 'MONICA', 'monica_source_registry.json'), 'utf8'));
const assessment = JSON.parse(fs.readFileSync(path.join(root, 'CONFIG', 'MONICA', 'monica_discovery_assessment.json'), 'utf8'));

assert.strictEqual(assessment.twin, 'MONICA');
assert.strictEqual(assessment.mode, 'DISCOVERY_ONLY');
assert.strictEqual(assessment.productionSoakIsolation, true);
assert.strictEqual(assessment.activationBlocked, true);
assert.strictEqual(assessment.outreachBlocked, true);
assert.strictEqual(assessment.campaignEnrollmentBlocked, true);
assert.strictEqual(registry.outreachBlocked, true);

const expectedLanes = new Set([
  'STATE_PROVEN_FEDERAL_READY',
  'SAM_REGISTERED_NO_OR_LOW_FEDERAL_REVENUE',
  'FORMER_GSA_NO_SALES / FAILED_ACTIVATION',
  'FEDERAL_SUB_TO_PRIME_READY',
  'COMMERCIAL_SUCCESS_WITH_GOVERNMENT_ENTRY_INTENT'
]);

assert.strictEqual(assessment.phase1Lanes.length, 5);
for (const lane of assessment.phase1Lanes) {
  assert.ok(expectedLanes.has(lane.lane), `unexpected Phase-1 lane ${lane.lane}`);
  assert.strictEqual(lane.candidateCount, null, `${lane.lane} must not fabricate a candidate count before harvest`);
  assert.strictEqual(lane.candidateCountStatus, 'NOT_MEASURED');
  assert.strictEqual(lane.evidenceQualityCounts.HIGH, null);
  assert.strictEqual(lane.evidenceQualityCounts.MEDIUM, null);
  assert.strictEqual(lane.evidenceQualityCounts.LOW, null);
}

const sourceFamilies = new Set(registry.sources.map(source => source.sourceFamily));
for (const family of assessment.sourceFamilyAssessment) {
  assert.ok(sourceFamilies.has(family.sourceFamily), `assessment family ${family.sourceFamily} must originate in the validated source registry`);
  assert.ok(!/OUTREACH|CAMPAIGN_ENROLL/i.test(family.disposition), 'disposition must not enable marketing activation');
}

for (const source of registry.sources) {
  assert.strictEqual(source.automaticOutreachAllowed, false, `${source.id} may not allow automatic outreach`);
}

assert.ok(Array.isArray(assessment.phase2Hold) && assessment.phase2Hold.some(row => row.lane === 'LOCAL_PROVEN_STATE_READY' && row.status === 'HOLD'));
assert.deepStrictEqual(assessment.governingPipeline, ['SOURCE','HARVEST','VET','SUPPRESS','QUALIFY','MARKET_SIZE','ACQUISITION_STRATEGY']);

console.log('PASS: MONICA discovery assessment is evidence-gated, non-fabricating, outreach-blocked, and isolated from production soak.');
