'use strict';

const assert = require('assert');
const path = require('path');
const {
  classifySourceFile,
  scoreSourceCandidate,
  EXPECTED_TABLES
} = require('../SERVICES/orion/OrionRebuildReadinessService');

assert.strictEqual(classifySourceFile('C:/x/ORION_DEMO_LIVE_READY.db'), 'ORION_DB');
assert.strictEqual(classifySourceFile('C:/Downloads/USASPENDING_PRIME_AWARDS_2026.zip'), 'USASPENDING_ARCHIVE');
assert.strictEqual(classifySourceFile('C:/Downloads/usaspending_subaward_contracts.csv'), 'SOURCE_CSV');
assert.strictEqual(classifySourceFile('C:/x/random.sqlite'), 'SQLITE_DB');
assert.strictEqual(classifySourceFile('C:/x/readme.txt'), null);
assert.strictEqual(classifySourceFile('C:/Downloads/unrelated_budget.csv'), null, 'unrelated CSVs must not be treated as ORION refresh inputs');

const current = Date.now() - 100000;
const freshArchive = scoreSourceCandidate({
  type: 'USASPENDING_ARCHIVE',
  mtimeMs: Date.now(),
  size: 2 * 1024 * 1024,
  name: 'USASPENDING_2026.zip'
}, current);
const oldDb = scoreSourceCandidate({
  type: 'SQLITE_DB',
  mtimeMs: current - 100000,
  size: 1000,
  name: 'old.sqlite'
}, current);
assert(freshArchive > oldDb, 'new official-source archive should outrank stale generic sqlite');
assert(EXPECTED_TABLES.includes('contractors'));
assert(EXPECTED_TABLES.includes('recompetes'));
assert.strictEqual(path.basename('C:/x/ORION_DEMO_LIVE_READY.db'), 'ORION_DEMO_LIVE_READY.db');

console.log('ORION_REBUILD_READINESS_TEST=GREEN');
