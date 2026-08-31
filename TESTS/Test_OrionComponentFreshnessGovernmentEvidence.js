'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OrionComponentFreshnessService = require('../SERVICES/orion/OrionComponentFreshnessService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-orion-freshness-'));
const refresh = path.join(root, 'DATA', 'orion_refresh');
const gsaDir = path.join(refresh, 'gsa_execution');
fs.mkdirSync(gsaDir, { recursive: true });

const nowMs = Date.parse('2026-08-31T23:30:00.000Z');
const samDb = path.join(refresh, 'sam_qualified.db');
const segmented = path.join(gsaDir, 'gsa_segmented.jsonl');
const sample = path.join(gsaDir, 'sample_truth.json');
fs.writeFileSync(samDb, 'fixture');
fs.writeFileSync(segmented, '{}\n');
fs.writeFileSync(sample, '{}');

fs.writeFileSync(path.join(refresh, 'latest_sam_qualified_universe_build.json'), JSON.stringify({
  ok: true,
  generatedAt: '2026-08-31T22:30:00.000Z',
  source: { date: '20260802' },
  output: { database: samDb, storedQualifiedCompanies: 386980 },
  safety: { productionDatabaseModified: false, stagingOnly: true }
}));

fs.writeFileSync(path.join(gsaDir, 'latest_gsa_final_acceptance_report.json'), JSON.stringify({
  ok: true,
  status: 'MISSION_ACCEPTED',
  fullMissionComplete: true,
  generatedAt: '2026-08-31T22:45:00.000Z',
  counts: { currentHoldersSegmented: 1234, campaignReady: 222 },
  outputPaths: { segmentedHolders: segmented, sampleTruthReport: sample },
  safety: { productionOrionModified: false }
}));

const result = new OrionComponentFreshnessService({ rootDir: root, nowMs }).run();
assert.strictEqual(result.samEvidenceUsable, true);
assert.strictEqual(result.gsaEvidenceUsable, true);
assert.strictEqual(result.components.samRegistration.fresh, true);
assert.strictEqual(result.components.samRegistration.qualifiedCompanies, 386980);
assert.strictEqual(result.components.gsaVehicleIntelligence.fresh, true);
assert.strictEqual(result.components.gsaVehicleIntelligence.currentHoldersSegmented, 1234);
assert.ok(result.freshComponents.includes('samRegistration'));
assert.ok(result.freshComponents.includes('gsaVehicleIntelligence'));
assert.strictEqual(result.fullyFresh, false, 'opportunities/recommendations/personas must remain unresolved');

console.log('ORION_COMPONENT_FRESHNESS_GOVERNMENT_EVIDENCE_TEST_PASS');
