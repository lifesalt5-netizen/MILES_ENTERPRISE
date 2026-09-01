'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const OrionContractStagingBuildService = require('../SERVICES/orion/OrionContractStagingBuildService');
const deriveContractSummaries = require('../SERVICES/orion/OrionContractSummaryDerivationService');

const db = new Database(':memory:');
const base = new OrionContractStagingBuildService({ rootDir: process.cwd(), Database });
base.ensureSchema(db);

const insert = db.prepare(`INSERT INTO orion_award_refresh_fy2026 (
  uei, award_key, obligation, current_total_value, potential_total_value,
  action_date_last, pop_current_end_date, awarding_agency, awarding_office,
  source_archive, source_entry, refreshed_at
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

insert.run('UEI-TEST-1', 'AWARD-1', 100, 100, 125, '2026-08-01', '2027-08-01', 'Agency Alpha', 'Shared Buying Office', 'fixture.zip', 'a.csv', '2026-09-01T00:00:00Z');
insert.run('UEI-TEST-1', 'AWARD-2', 200, 200, 250, '2026-08-02', '2027-08-02', 'Agency Beta', 'Shared Buying Office', 'fixture.zip', 'b.csv', '2026-09-01T00:00:00Z');

assert.doesNotThrow(() => deriveContractSummaries(db, '2026-09-01T01:00:00Z'), 'same UEI/buyer under multiple agency labels must not violate buyer-summary PK');

const buyers = db.prepare('SELECT * FROM orion_buyer_fy2026_summary WHERE uei=?').all('UEI-TEST-1');
assert.strictEqual(buyers.length, 1, 'buyer summary grain must be exactly UEI + buyer_name');
assert.strictEqual(buyers[0].buyer_name, 'Shared Buying Office');
assert.strictEqual(buyers[0].award_count, 2);
assert.strictEqual(buyers[0].spend, 300);
assert.strictEqual(buyers[0].agency, null, 'conflicting agency evidence must remain UNKNOWN/null rather than choosing one');

const contractor = db.prepare('SELECT * FROM orion_contractor_fy2026_summary WHERE uei=?').get('UEI-TEST-1');
assert.strictEqual(contractor.award_count, 2);
assert.strictEqual(contractor.federal_obligations, 300);

const recompetes = db.prepare('SELECT COUNT(*) n FROM orion_recompete_fy2026 WHERE uei=?').get('UEI-TEST-1').n;
assert.strictEqual(recompetes, 2);

console.log('ORION_CONTRACT_SUMMARY_DERIVATION=GREEN');
db.close();
