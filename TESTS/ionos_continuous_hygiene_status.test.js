'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { continuousHygieneStatus } = require('../SCRIPTS/RunIonosInboxCleanup');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-ionos-hygiene-status-'));
const artifact = path.join(root, 'DATA', 'runtime', 'revenue', 'ionos_hygiene', 'ionos_inbox_hygiene_latest.json');
fs.mkdirSync(path.dirname(artifact), { recursive: true });
fs.writeFileSync(artifact, JSON.stringify({
  ok: true,
  status: 'ACTIVE',
  enabled: true,
  execute: true,
  generatedAt: new Date().toISOString(),
  totals: {
    scanned: 12,
    routedHighConfidenceNoise: 3,
    keptUncertainOrActionable: 9,
    inboxAfter: 9,
    remainingHighConfidenceRoutableNoise: 0
  },
  accounts: [{
    account: 'info@example.com',
    ok: true,
    scanned: 12,
    routedHighConfidenceNoise: 3,
    keptUncertainOrActionable: 9,
    folders: { 'MILES-SYSTEM': 3 },
    verification: {
      inboxAfter: 9,
      remainingHighConfidenceRoutableNoise: 0,
      keptUncertainOrActionable: 9
    }
  }],
  errors: [],
  safety: { deletesMessages: false, usesUidMoveOnly: true },
  producer: { pid: 1234, runtimeName: 'test' }
}, null, 2));

const status = continuousHygieneStatus(root);
assert.strictEqual(status.available, true);
assert.strictEqual(status.ok, true);
assert.strictEqual(status.status, 'ACTIVE');
assert.strictEqual(status.enabled, true);
assert.strictEqual(status.execute, true);
assert.strictEqual(status.totals.remainingHighConfidenceRoutableNoise, 0);
assert.strictEqual(status.accounts.length, 1);
assert.strictEqual(status.accounts[0].verification.remainingHighConfidenceRoutableNoise, 0);
assert.strictEqual(status.safety.deletesMessages, false);
assert.strictEqual(status.producer.pid, 1234);
assert(Number.isFinite(status.artifactAgeSeconds));

const missing = continuousHygieneStatus(path.join(root, 'missing'));
assert.strictEqual(missing.available, false);
assert(missing.error);

fs.rmSync(root, { recursive: true, force: true });
console.log('IONOS_CONTINUOUS_HYGIENE_STATUS_REPORTER=PASS');
