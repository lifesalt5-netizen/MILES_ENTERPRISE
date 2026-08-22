'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'CONFIG', 'MONICA', 'monica_source_registry.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'CONFIG', 'MONICA', 'monica_source_access_manifest.json'), 'utf8'));

assert.strictEqual(manifest.mode, 'DISCOVERY_ONLY');
assert.strictEqual(manifest.productionSoakIsolation, true);
assert.strictEqual(manifest.outreachBlocked, true);
assert.strictEqual(manifest.campaignEnrollmentBlocked, true);

const registered = new Set((registry.sources || []).map(s => s.id));
const mapped = new Map((manifest.sources || []).map(s => [s.sourceId, s]));
assert.strictEqual(mapped.size, registered.size, 'every registered MONICA source must have an access-manifest entry');
for (const sourceId of registered) assert.ok(mapped.has(sourceId), `missing access manifest for ${sourceId}`);

for (const row of manifest.sources || []) {
  assert.ok(registered.has(row.sourceId), `manifest source must exist in source registry: ${row.sourceId}`);
  if (row.status === 'VERIFIED_OFFICIAL_ACCESS') {
    assert.ok(/^https:\/\//.test(row.officialUrl || ''), `${row.sourceId} verified source requires official HTTPS URL`);
    assert.ok(row.evidence, `${row.sourceId} verified source requires evidence summary`);
  } else {
    assert.strictEqual(row.officialUrl, null, `${row.sourceId} pending source must not invent an official URL`);
    assert.ok((row.constraints || []).some(v => /VERIF|MANIFEST|REQUIRED/i.test(v)), `${row.sourceId} pending source must fail closed`);
  }
}

console.log('PASS: MONICA source access manifest covers every registered source, uses official access only, and fails closed when access is unverified.');
