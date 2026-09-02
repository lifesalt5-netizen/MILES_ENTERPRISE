'use strict';

const assert = require('assert');
const engine = require('../SERVICES/revenue/MasterContractorTaxonomyEngine');

assert.strictEqual(engine.salesBand(0), '0');
assert.strictEqual(engine.salesBand(99999.99), 'lt_100k');
assert.strictEqual(engine.salesBand(100000), '100k_500k');
assert.strictEqual(engine.salesBand(750000), '500k_1m');
assert.strictEqual(engine.salesBand(2500000), '1m_3m');
assert.strictEqual(engine.salesBand(4000000), '3m_5m');
assert.strictEqual(engine.salesBand(9000000), '5m_10m');
assert.strictEqual(engine.salesBand(20000000), '10m_25m');
assert.strictEqual(engine.salesBand(40000000), '25m_50m');
assert.strictEqual(engine.salesBand(90000000), '50m_100m');
assert.strictEqual(engine.salesBand(100000000), '100m_plus');
assert.strictEqual(engine.salesBand(null), 'UNKNOWN');

assert.strictEqual(engine.awardRole({ primeAwardCount: 1, subawardCount: 0 }), 'PRIME');
assert.strictEqual(engine.awardRole({ primeAwardCount: 0, subawardCount: 1 }), 'SUB');
assert.strictEqual(engine.awardRole({ primeAwardCount: 1, subawardCount: 1 }), 'BOTH');
assert.strictEqual(engine.awardRole({}), 'NO_PROVEN_AWARD_ROLE');

assert.strictEqual(engine.recencyBand(2026), 'AWARD_CURRENT_FY');
assert.strictEqual(engine.recencyBand(2025), 'AWARD_PRIOR_1Y');
assert.strictEqual(engine.recencyBand(2021), 'AWARD_PRIOR_5Y');
assert.strictEqual(engine.recencyBand(2020), 'UNKNOWN');

assert.strictEqual(engine.primaryFallbackSegment('BOTH', '1m_3m'), 'awarded_both_1m_3m');
assert.deepStrictEqual(engine.contactReadiness({ verifiedEmail: true, phone: true }), ['VERIFIED_EMAIL', 'PHONE']);
assert.strictEqual(engine.enrichmentState({ companyKnown: true, verifiedEmail: false, unsuppressedEmail: false }), 'CONTACT_REQUIRED');

console.log('MASTER_CONTRACTOR_TAXONOMY_ENGINE_TEST=GREEN');
