'use strict';

const assert = require('assert');
const path = require('path');
const MonicaDiscoveryCandidateService = require('../SERVICES/monica/MonicaDiscoveryCandidateService');

const root = path.resolve(__dirname, '..');
const service = new MonicaDiscoveryCandidateService({ root });

const rows = [
  {
    companyName: 'Example State Vendor LLC',
    uei: 'ABC123XYZ789',
    domain: 'example-state-vendor.com',
    state: 'TX',
    sourceId: 'TX_CMBL',
    lane: 'STATE_PROVEN_FEDERAL_READY',
    sourceEvidence: { registrationId: 'CMBL-1', url: 'https://example.test/cmbl/1' },
    federalGapEvidence: { primeAwards: 0, federalRevenue: 0 },
    suppressionStatus: 'CLEAR',
    contactabilityStatus: 'CONTACTABLE',
    observedAt: '2026-08-22T00:00:00Z'
  },
  {
    companyName: 'Example State Vendor LLC',
    uei: 'ABC123XYZ789',
    sourceId: 'TX_CMBL',
    lane: 'STATE_PROVEN_FEDERAL_READY',
    sourceEvidence: { registrationId: 'CMBL-1', awardId: 'TX-AWARD-55', url: 'https://example.test/award/55' },
    federalGapEvidence: { primeAwards: 0, federalRevenue: 0, gsaPosition: false },
    suppressionStatus: 'CLEAR',
    contactabilityStatus: 'CONTACTABLE',
    observedAt: '2026-08-22T01:00:00Z'
  },
  {
    companyName: 'Former Schedule Vendor Inc',
    domain: 'former-schedule.example',
    sourceId: 'GSA_ELIBRARY_SSQ',
    lane: 'FORMER_GSA_NO_SALES / FAILED_ACTIVATION',
    sourceEvidence: { contractNumber: '47QTCA...', url: 'https://example.test/gsa' },
    federalGapEvidence: { scheduleStatus: 'EXPIRED', scheduleSales: 0 },
    suppressionStatus: 'SUPPRESSED_ACTIVE_OPPORTUNITY',
    contactabilityStatus: 'CONTACTABLE'
  }
];

const result = service.measure(rows);
assert.strictEqual(result.mode, 'DISCOVERY_ONLY');
assert.strictEqual(result.rows.length, 2, 'same UEI must dedupe to one company candidate');
assert.ok(result.rows.every(r => r.outreachEligible === false));
assert.ok(result.rows.every(r => r.campaignEnrollmentEligible === false));
assert.ok(result.rows.every(r => r.provenance && r.provenance.url));
assert.strictEqual(result.lanes.STATE_PROVEN_FEDERAL_READY.candidateCount, 1);
assert.strictEqual(result.lanes.STATE_PROVEN_FEDERAL_READY.contactableCount, 1);
assert.strictEqual(result.lanes['FORMER_GSA_NO_SALES / FAILED_ACTIVATION'].candidateCount, 1);
assert.strictEqual(result.lanes['FORMER_GSA_NO_SALES / FAILED_ACTIVATION'].suppressedCount, 1);
assert.strictEqual(result.lanes.STATE_PROVEN_FEDERAL_READY.outreachBlocked, true);

assert.throws(() => service.normalize({ companyName:'Bad Source Co', sourceId:'DOES_NOT_EXIST', lane:'STATE_PROVEN_FEDERAL_READY', provenanceUrl:'https://example.test' }), /MONICA_UNKNOWN_SOURCE/);
assert.throws(() => service.normalize({ companyName:'No Evidence Co', sourceId:'TX_CMBL', lane:'STATE_PROVEN_FEDERAL_READY' }), /MONICA_PROVENANCE_REQUIRED/);
assert.throws(() => service.normalize({ companyName:'Wrong Lane Co', sourceId:'TX_CMBL', lane:'FEDERAL_SUB_TO_PRIME_READY', provenanceUrl:'https://example.test' }), /MONICA_INVALID_LANE_SOURCE/);

console.log('PASS: MONICA candidate normalization is provenance-gated, deduped, evidence-scored, suppression-aware, and discovery-only.');
