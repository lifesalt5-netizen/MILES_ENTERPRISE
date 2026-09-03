'use strict';

const assert = require('assert');
const validation = require('../SCRIPTS/ValidateOrionPostRefresh');

const sidecar = {
  ok: true,
  sidecarBytes: 4097200128,
  safety: { productionDatabaseModified: false, sidecarOnly: true },
  validation: {
    ok: true,
    integrity: 'ok',
    awardRows: 3667413,
    summaryRows: 82835,
    buyerRows: 206689,
    recompeteRows: 3583555
  }
};

const counts = validation.buildEvidence(sidecar, 4097200128);
assert.deepStrictEqual(counts, {
  integrity: 'ok',
  awards: 3667413,
  contractors: 82835,
  buyers: 206689,
  recompetes: 3583555
});

assert.throws(() => validation.buildEvidence({ ...sidecar, validation: { ...sidecar.validation, integrity: 'bad' } }, 4097200128), /BUILD_VALIDATION_NOT_GREEN/);
assert.throws(() => validation.buildEvidence(sidecar, 1), /SIZE_MISMATCH/);
assert.throws(() => validation.buildEvidence({ ...sidecar, safety: { productionDatabaseModified: true, sidecarOnly: true } }, 4097200128), /SAFETY_ASSERTION_FAILED/);

const allTableRows = validation.EXPECTED_TABLES.map(name => ({ name }));
const fakeDb = {
  prepare(sql) {
    if (sql.includes('sqlite_master')) return { all: () => allTableRows };
    const table = validation.EXPECTED_TABLES.find(name => sql.includes(name));
    if (!table) throw new Error(`unexpected sql ${sql}`);
    return { get: () => ({ readable: 1 }) };
  }
};
const audit = validation.fastReadAudit(fakeDb);
assert.deepStrictEqual(audit.missingTables, []);
assert.strictEqual(Object.values(audit.readable).every(Boolean), true);

const missingDb = {
  prepare(sql) {
    if (sql.includes('sqlite_master')) return { all: () => allTableRows.slice(1) };
    return { get: () => ({ readable: 1 }) };
  }
};
assert.throws(() => validation.fastReadAudit(missingDb), /EXPECTED_TABLES_MISSING/);

const unreadableDb = {
  prepare(sql) {
    if (sql.includes('sqlite_master')) return { all: () => allTableRows };
    if (sql.includes(validation.EXPECTED_TABLES[2])) return { get: () => undefined };
    return { get: () => ({ readable: 1 }) };
  }
};
assert.throws(() => validation.fastReadAudit(unreadableDb), /TABLE_NOT_READABLE/);

const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'SCRIPTS', 'ValidateOrionPostRefresh.js'), 'utf8');
assert(!source.includes("pragma('integrity_check'"));
assert(!source.includes('SELECT COUNT(*)'));
assert(source.includes("validationMode: 'BUILD_EVIDENCE_PLUS_READ_ONLY_SCHEMA_AND_SAMPLE'"));
assert(source.includes('fullIntegrityRescanPerformed: false'));

console.log('ORION_POST_REFRESH_VALIDATION_TEST=GREEN');
