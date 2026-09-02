'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mod = require('../SCRIPTS/RunRevenueAcceptanceLatestPlacement');
const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunRevenueAcceptanceLatestPlacement.js'), 'utf8');

const now = new Date().toISOString();
const good = mod.resolveLatestPlacementTestId({ mode: 'EXECUTE', generatedAt: now, testId: 'fresh-test-123' });
assert.strictEqual(good.ok, true);
assert.strictEqual(good.testId, 'fresh-test-123');
assert.strictEqual(good.executeEvidence, true);
assert.strictEqual(good.fresh, true);

const planOnly = mod.resolveLatestPlacementTestId({ mode: 'PLAN_ONLY', generatedAt: now, testId: 'x' });
assert.strictEqual(planOnly.ok, false);
assert.strictEqual(planOnly.reason, 'LATEST_PLACEMENT_EVIDENCE_NOT_EXECUTED_TEST');

const stale = mod.resolveLatestPlacementTestId({ mode: 'EXECUTE', generatedAt: '2026-08-20T00:00:00.000Z', testId: 'x' });
assert.strictEqual(stale.ok, false);
assert.strictEqual(stale.reason, 'LATEST_PLACEMENT_TEST_EVIDENCE_STALE');

const missing = mod.resolveLatestPlacementTestId({ mode: 'EXECUTE', generatedAt: now });
assert.strictEqual(missing.ok, false);
assert.strictEqual(missing.reason, 'LATEST_PLACEMENT_TEST_ID_MISSING');

assert(src.includes("RunRevenueAcceptanceSprint.js', '--test-id', testId"));
assert(src.includes('historicalDefaultTestIgnored: true'));
assert(src.includes('failClosedIfLatestEvidenceMissingOrStale: true'));
assert(!src.includes('01a040ce-dbf7-7872-8938-f1501647af92'));

console.log('REVENUE_ACCEPTANCE_LATEST_PLACEMENT_TEST=PASS');
