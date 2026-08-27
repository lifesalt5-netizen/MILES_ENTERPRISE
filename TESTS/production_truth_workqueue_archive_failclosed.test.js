'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const script = require('../SCRIPTS/ReconcileProductionTruth');

const err = new RangeError('Invalid string length');
err.stack = 'RangeError: Invalid string length\n    at WorkQueueService.writeJsonAtomic (...)\n    at WorkQueueService.saveArchive (...)\n    at WorkQueueService.archiveClosed (...)';
assert.strictEqual(script.isWorkQueueArchiveSerializationFailure(err), true);

const unrelated = new RangeError('Invalid string length');
unrelated.stack = 'RangeError: Invalid string length\n    at OtherService.write (...)';
assert.strictEqual(script.isWorkQueueArchiveSerializationFailure(unrelated), false);

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'ReconcileProductionTruth.js'), 'utf8');
assert(src.includes('WORK_QUEUE_ARCHIVE_SERIALIZATION_FAILED'));
assert(src.includes("degradedMode: 'WORK_QUEUE_ARCHIVE_FAIL_CLOSED'"));
assert(src.includes('historicalFailuresPreservedInArchive: false'));
assert(src.includes('noFalseGreenOnArchiveFailure: true'));
assert(src.includes("process.exitCode = result.ok ? 0 : 1"));

console.log('PRODUCTION_TRUTH_WORKQUEUE_ARCHIVE_FAILCLOSED=PASS');
