'use strict';

const assert = require('assert');
const service = require('../SERVICES/revenue/CanonicalAwardedContractorMasterService');

assert.strictEqual(service.awardTier(0), '0_500k');
assert.strictEqual(service.awardTier(499999.99), '0_500k');
assert.strictEqual(service.awardTier(500000), '500k_3m');
assert.strictEqual(service.awardTier(2999999.99), '500k_3m');
assert.strictEqual(service.awardTier(3000000), '3m_5m');
assert.strictEqual(service.awardTier(5000000), '5m_plus');

assert.strictEqual(service.fallbackSegment('PRIME', 250000), 'awarded_prime_0_500k');
assert.strictEqual(service.fallbackSegment('SUB', 750000), 'awarded_sub_500k_3m');
assert.strictEqual(service.fallbackSegment('BOTH', 4000000), 'awarded_both_3m_5m');
assert.strictEqual(service.fallbackSegment('BOTH', 9000000), 'awarded_both_5m_plus');

assert.strictEqual(service.lifecycleState({ company: 'Acme', verifiedContact: true }), 'OUTBOUND_READY');
assert.strictEqual(service.lifecycleState({ company: 'Acme', hasUnsuppressedEmail: true }), 'CONTACT_VERIFICATION_REQUIRED');
assert.strictEqual(service.lifecycleState({ company: 'Acme' }), 'CONTACT_ENRICHMENT_REQUIRED');
assert.strictEqual(service.lifecycleState({ company: '' }), 'IDENTITY_ENRICHMENT_REQUIRED');
assert.strictEqual(service.lifecycleState({ company: 'Acme', existingClient: true, verifiedContact: true }), 'EXISTING_CLIENT');
assert.strictEqual(service.lifecycleState({ company: 'Acme', accountDoNotProspect: true, verifiedContact: true }), 'DO_NOT_PROSPECT');

console.log('CANONICAL_AWARDED_CONTRACTOR_MASTER_SEGMENTATION_TEST=GREEN');
