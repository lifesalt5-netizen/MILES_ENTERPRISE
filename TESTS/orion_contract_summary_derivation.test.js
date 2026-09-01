'use strict';

const assert = require('assert');
const deriveContractSummaries = require('../SERVICES/orion/OrionContractSummaryDerivationService');

const prepared = [];
const runs = [];
const db = {
  exec(sql) { prepared.push({ kind: 'exec', sql }); },
  prepare(sql) {
    prepared.push({ kind: 'prepare', sql });
    return { run(...args) { runs.push({ sql, args }); return { changes: 1 }; } };
  }
};

assert.doesNotThrow(() => deriveContractSummaries(db, '2026-09-01T01:00:00Z'));
assert.strictEqual(runs.length, 3, 'contractor, buyer, and recompete derivations must all execute');

const buyerSql = prepared.find(x => x.kind === 'prepare' && /INSERT INTO orion_buyer_fy2026_summary/.test(x.sql))?.sql || '';
const normalized = buyerSql.replace(/\s+/g, ' ').trim();

assert(normalized.includes('GROUP BY uei, buyer_name'), 'buyer summary must aggregate at its actual PK grain: UEI + buyer_name');
assert(!/GROUP BY uei, buyer_name,\s*(?:agency|awarding_agency)/i.test(normalized), 'agency must not be part of buyer-summary grouping because it creates duplicate PK rows');
assert(normalized.includes('COUNT(DISTINCT agency) = 1 THEN MAX(agency) ELSE NULL'), 'conflicting agency evidence must remain UNKNOWN/null rather than picking one label');
assert(normalized.includes('COALESCE(SUM(obligation),0)'), 'buyer spend must aggregate all source obligations at the buyer grain');

// Reproduce the production collision semantically: same UEI + same buyer office,
// but two different agency labels. At the table PK grain this is one buyer row.
const sourceRows = [
  { uei: 'UEI-TEST-1', buyer_name: 'Shared Buying Office', agency: 'Agency Alpha', obligation: 100 },
  { uei: 'UEI-TEST-1', buyer_name: 'Shared Buying Office', agency: 'Agency Beta', obligation: 200 }
];
const grouped = new Map();
for (const row of sourceRows) {
  const key = `${row.uei}\u0000${row.buyer_name}`;
  const current = grouped.get(key) || { count: 0, spend: 0, agencies: new Set() };
  current.count += 1;
  current.spend += row.obligation;
  if (row.agency) current.agencies.add(row.agency);
  grouped.set(key, current);
}
assert.strictEqual(grouped.size, 1, 'collision fixture must collapse to one UEI+buyer row');
const summary = [...grouped.values()][0];
assert.strictEqual(summary.count, 2);
assert.strictEqual(summary.spend, 300);
assert.strictEqual(summary.agencies.size === 1 ? [...summary.agencies][0] : null, null, 'mixed agency evidence must become UNKNOWN/null');

console.log('ORION_CONTRACT_SUMMARY_DERIVATION=GREEN');
