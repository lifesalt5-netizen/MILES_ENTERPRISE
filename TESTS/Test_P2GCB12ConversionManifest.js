'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'CONFIG', 'p2gc_b12_conversion_publish_v2.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

assert.equal(manifest.system, 'P2GC B12 Conversion Publish V2');
assert.equal(manifest.site, 'pathways2gc.com');
assert.equal(manifest.mode, 'CONTROLLED_STAGING_FIRST');
assert.equal(manifest.required_gates.MILES_DRY_RUN, false);
assert.equal(manifest.required_gates.MILES_CONTROLLED_WRITE_ENABLED, true);
assert.equal(manifest.required_gates.B12_WRITE_ENABLED, true);
assert.equal(manifest.required_gates.B12_PUBLISH_ENABLED, true);

const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
assert.equal(operations.length, 5);
const ids = new Set(operations.map(x => x.id));
assert.equal(ids.size, operations.length);
for (const expected of ['HOMEPAGE_CONVERSION_V2','GSA_ZERO_SALES_PAGE','FEDERAL_REVENUE_GAP_PAGE','RECOMPETE_VEHICLE_PAGE','LEGACY_POSITIONING_CLEANUP']) {
  assert.ok(ids.has(expected), `Missing operation ${expected}`);
}

const positiveGuarantee = /\b(?:(?:we|p2gc|our\s+(?:service|team))\s+(?:will\s+)?guarantee(?:d)?|guaranteed)\s+(?:award|sales|revenue|win)s?\b/i;
const pages = operations.filter(x => x.id !== 'LEGACY_POSITIONING_CLEANUP');
for (const op of pages) {
  assert.ok(String(op.prompt || '').length > 100, `${op.id} prompt is unexpectedly short`);
  assert.ok(Array.isArray(op.required_markers) && op.required_markers.length >= 3, `${op.id} needs staging markers`);
  assert.ok(!positiveGuarantee.test(op.prompt), `${op.id} contains prohibited positive guarantee language`);
}

const targets = new Set(pages.map(x => x.target));
assert.ok(targets.has('/'));
assert.ok(targets.has('/gsa-zero-sales-diagnostic'));
assert.ok(targets.has('/federal-revenue-gap-analysis'));
assert.ok(targets.has('/recompete-vehicle-growth-scan'));

const legacy = operations.find(x => x.id === 'LEGACY_POSITIONING_CLEANUP');
assert.equal(legacy.target, '/business-plans');
assert.ok(/noindex|hide|remove/i.test(legacy.prompt));

assert.deepEqual(manifest.public_validation.required_paths, [
  '/gsa-zero-sales-diagnostic',
  '/federal-revenue-gap-analysis',
  '/recompete-vehicle-growth-scan'
]);

console.log('P2GC B12 conversion manifest tests passed');
