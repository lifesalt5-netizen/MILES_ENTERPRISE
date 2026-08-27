'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_ARCHIVE_ROTATE_MIB,
  archiveRotateThresholdMiB,
  rotateOversizedWorkQueueArchive
} = require('../SCRIPTS/ReconcileProductionTruth');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-archive-rotation-'));
const runtimeDir = path.join(root, 'DATA', 'runtime');
const archivePath = path.join(runtimeDir, 'work_queue_archive.json');
fs.mkdirSync(runtimeDir, { recursive: true });

try {
  assert.strictEqual(archiveRotateThresholdMiB({}), DEFAULT_ARCHIVE_ROTATE_MIB);
  assert.strictEqual(archiveRotateThresholdMiB({ MILES_WORK_QUEUE_ARCHIVE_ROTATE_MIB: '256' }), 256);
  assert.strictEqual(archiveRotateThresholdMiB({ MILES_WORK_QUEUE_ARCHIVE_ROTATE_MIB: '32' }), DEFAULT_ARCHIVE_ROTATE_MIB);

  fs.writeFileSync(archivePath, '[]\n', 'utf8');
  const small = rotateOversizedWorkQueueArchive(root, { thresholdMiB: 1 });
  assert.strictEqual(small.ok, true);
  assert.strictEqual(small.rotated, false);
  assert.strictEqual(small.reason, 'ARCHIVE_WITHIN_BOUND');

  const oversizedBytes = 2 * 1024 * 1024;
  fs.writeFileSync(archivePath, Buffer.alloc(oversizedBytes, 0x20));
  const rotated = rotateOversizedWorkQueueArchive(root, { thresholdMiB: 1 });
  assert.strictEqual(rotated.ok, true);
  assert.strictEqual(rotated.rotated, true);
  assert.strictEqual(rotated.reason, 'ARCHIVE_ROTATED_BEFORE_NODE_STRING_LIMIT');
  assert.strictEqual(rotated.historicalEvidencePreserved, true);
  assert.strictEqual(rotated.preservedBytes, oversizedBytes);
  assert(fs.existsSync(rotated.segmentPath));
  assert.strictEqual(fs.statSync(rotated.segmentPath).size, oversizedBytes);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(archivePath, 'utf8')), []);

  console.log('WORK_QUEUE_ARCHIVE_ROTATION=PASS');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
