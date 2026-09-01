'use strict';

const assert = require('assert');
const policy = require('../SERVICES/governance/GsaEbuyAccessPolicyService');
const DemoUnifiedOpportunityService = require('../SERVICES/demo/DemoUnifiedOpportunityService');

const denied = policy.evaluate({ source:'GSA eBuy', sourceUrl:'https://www.ebuy.gsa.gov/ebuy/', stage:'OPEN' });
assert.strictEqual(denied.allowed, false);
assert.strictEqual(denied.status, 'EBUY_LIVE_ACCESS_NOT_AUTHORIZED');
assert.strictEqual(denied.requiresFallback, true);

const noEvidence = policy.evaluate({ source:'GSA eBuy', authorizedEbuyAccess:true, stage:'OPEN' });
assert.strictEqual(noEvidence.allowed, false);
assert.strictEqual(noEvidence.reason, 'ACCESS_EVIDENCE_REQUIRED');

const authorized = policy.evaluate({
  source:'GSA eBuy',
  authorizedEbuyAccess:true,
  accessEvidenceId:'client-authorization-proof-1',
  withinGrantedScope:true,
  stage:'OPEN'
});
assert.strictEqual(authorized.allowed, true);
assert.strictEqual(authorized.live, true);
assert.strictEqual(authorized.requiredLabel, 'AUTHORIZED_EBUY_LIVE');

const proxy = policy.evaluate({
  source:'GSA eBuy public award reconstruction',
  sourceAccess:'GSA_PUBLIC_HISTORICAL_PROXY',
  stage:'RECENT_SIMILAR_AWARD'
});
assert.strictEqual(proxy.allowed, true);
assert.strictEqual(proxy.live, false);
assert.strictEqual(proxy.requiredLabel, 'GSA_PUBLIC_HISTORICAL_PROXY');

const service = new DemoUnifiedOpportunityService();
const result = service.build({ opportunities:{ liveAndForecast:[], recompetes:[], similarRecentAwards:[] } }, [
  { id:'EBUY-UNAUTH', source:'GSA eBuy', stage:'OPEN', title:'Gated RFQ' },
  { id:'PUBLIC-1', source:'USAspending.gov', stage:'RECENT_SIMILAR_AWARD', title:'Comparable GSA-linked award', sourceAccess:'PUBLIC_AWARD_HISTORY' }
]);
assert.strictEqual(result.sourceAccessGovernance.blockedUnauthorizedLiveEbuyRecords, 1);
assert.strictEqual(result.records.some(x => x.id === 'EBUY-UNAUTH'), false);
assert.strictEqual(result.records.some(x => x.id === 'PUBLIC-1'), true);
assert.strictEqual(result.rules.bypassAuthentication, false);
assert.strictEqual(result.rules.loginGatedSourcesNeverPretendedLive, true);

console.log('GSA_EBUY_ACCESS_POLICY_TEST_PASS');
