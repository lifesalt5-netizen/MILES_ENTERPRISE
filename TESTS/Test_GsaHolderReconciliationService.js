'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const GsaHolderReconciliationService = require('../SERVICES/orion/GsaHolderReconciliationService');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-gsa-recon-'));
  const snapRoot = path.join(root, 'DATA', 'staging', 'government_data', 'gsa_holder_snapshot');
  fs.mkdirSync(snapRoot, { recursive: true });

  function makeRun(name, rows) {
    const run = path.join(snapRoot, name);
    fs.mkdirSync(run, { recursive: true });
    const holders = path.join(run, 'gsa_current_mas_holders.jsonl');
    fs.writeFileSync(holders, rows.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
    const manifest = {
      ok: true,
      artifacts: [{ filePath: holders }]
    };
    const manifestPath = path.join(run, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return manifestPath;
  }

  const prior = makeRun('GSA-HOLDERS-2026-07-prior', [
    { contractNumber: '47AAA111', uei: 'UEI1', legalBusinessName: 'Alpha', state: 'FL' },
    { contractNumber: '47AAA222', uei: 'UEI2', legalBusinessName: 'Beta', state: 'VA' }
  ]);
  await new Promise(r => setTimeout(r, 10));
  const current = makeRun('GSA-HOLDERS-2026-08-current', [
    { contractNumber: '47AAA111', uei: 'UEI1', legalBusinessName: 'Alpha', state: 'TX' },
    { contractNumber: '47AAA333', uei: 'UEI3', legalBusinessName: 'Gamma', state: 'MD' }
  ]);

  const service = new GsaHolderReconciliationService({ rootDir: root });
  const result = await service.run({ currentManifestPath: current, priorManifestPath: prior });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.counts.newHolders, 1);
  assert.strictEqual(result.counts.removedOrExpiredHolders, 1);
  assert.strictEqual(result.counts.changedHolders, 1);
  assert.strictEqual(result.counts.currentUniqueIdentities, 2);
  assert.ok(fs.existsSync(result.reportPath));
  console.log('GSA_HOLDER_RECONCILIATION_TEST_PASS');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
