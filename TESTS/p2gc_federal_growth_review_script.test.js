'use strict';

const assert = require('assert');
const Service = require('../SERVICES/revenue/P2GCFederalGrowthReviewScriptService');

const svc = new Service({ wordsPerMinute: 135 });
const result = svc.build({
  company: { name: 'TEST FEDERAL CO' },
  findings: [
    {
      id: 'f1', section: 'VEHICLE_GSA_VA_POSITION', title: 'Current vehicle confirmed',
      finding: 'One current contract vehicle is confirmed.',
      whatItMeans: 'The company has a verified access path.',
      whyItMatters: 'New vehicle investment should not be recommended generically.',
      businessImpact: 'Avoids unnecessary spend and focuses utilization.',
      howP2GCAddressesIt: 'Validate buyer fit and actual vehicle performance.',
      source: 'AUTHORITATIVE_SOURCE', freshness: 'CURRENT', confidence: 'HIGH', verificationState: 'CONFIRMED', material: true
    },
    {
      id: 'f2', section: 'OPPORTUNITY_ENVIRONMENT', title: 'Expired opportunity must not appear',
      finding: 'This is expired.',
      whatItMeans: 'Nothing.', whyItMatters: 'Nothing.', businessImpact: 'Nothing.', howP2GCAddressesIt: 'Nothing.',
      source: 'SOURCE', freshness: 'EXPIRED', confidence: 'HIGH', verificationState: 'CONFIRMED', material: true, expired: true
    },
    {
      id: 'f3', section: 'FEDERAL_GROWTH_GAPS', title: 'Unknown is not zero',
      finding: 'Current obligation total is unavailable because the measurement window is not verified.',
      whatItMeans: 'Revenue must be described as unavailable rather than zero.',
      whyItMatters: 'A false zero would distort the company diagnosis.',
      businessImpact: 'Prevents an incorrect growth claim.',
      howP2GCAddressesIt: 'Resolve the authoritative measurement window before using the value.',
      source: 'AUTHORITATIVE_SOURCE', freshness: 'CURRENT', confidence: 'HIGH', verificationState: 'VERIFIED', material: true
    }
  ]
});

assert.strictEqual(result.ok, true);
assert.ok(result.fullText.includes('TEST FEDERAL CO'));
assert.ok(result.fullText.includes('unknown rather than zero'));
assert.ok(!result.fullText.includes('This is expired'));
assert.ok(result.sections.some(s => s.id === 'VEHICLE_GSA_VA_POSITION'));
assert.ok(result.sections.some(s => s.id === 'FEDERAL_GROWTH_GAPS'));
assert.ok(!result.sections.some(s => s.id === 'OPPORTUNITY_ENVIRONMENT'));
assert.ok(result.withheldPaidWork.includes('COMPLETE_BUYER_LISTS'));
assert.ok(Array.isArray(result.priorityOptions));

assert.throws(() => svc.build({ company: { name: 'TEST FEDERAL CO' }, findings: [{ title: 'Bad', finding: 'No provenance' }] }), /NO_VERIFIED_FINDINGS/);

console.log('P2GC_FEDERAL_GROWTH_REVIEW_SCRIPT_TEST_GREEN');
