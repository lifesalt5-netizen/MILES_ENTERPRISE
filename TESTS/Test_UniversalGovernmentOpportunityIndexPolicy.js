'use strict';

const assert = require('assert');
const universalPolicy = require('../SERVICES/governance/UniversalGovernmentOpportunityIndexPolicyService');
const clientPortalPolicy = require('../SERVICES/governance/ClientAuthorizedPortalAccessPolicyService');
const healthPolicy = require('../SERVICES/governance/ContinuousSystemHealthPolicyService');
const DemoUnifiedOpportunityService = require('../SERVICES/demo/DemoUnifiedOpportunityService');

(function run() {
  const publicLive = universalPolicy.classify({ source:'SAM.gov', stage:'OPEN', sourceAccess:'PUBLIC' }, {});
  assert.strictEqual(publicLive.allowed, true);
  assert.strictEqual(publicLive.badge, 'LIVE PUBLIC');

  const prospectRestricted = universalPolicy.classify({ source:'GSA eBuy', stage:'OPEN', sourceAccess:'GATED' }, {
    prospectDemo:true,
    activePayingClient:false,
    dedicatedClientWorkspace:false,
    authorizedAccess:false
  });
  assert.strictEqual(prospectRestricted.allowed, false);
  assert.strictEqual(prospectRestricted.badge, 'GATED / COVERAGE GAP');

  const authorized = clientPortalPolicy.evaluate({
    activePayingClient:true,
    dedicatedClientWorkspace:true,
    authorizedAccess:true,
    accessEvidenceId:'TEST-AUTH-1',
    withinGrantedScope:true,
    readWriteScope:'READ'
  });
  assert.strictEqual(authorized.allowed, true);
  assert.strictEqual(authorized.readOnlyDefault, true);

  const clientRestricted = universalPolicy.classify({ source:'GSA eBuy', stage:'OPEN', sourceAccess:'GATED' }, {
    activePayingClient:true,
    dedicatedClientWorkspace:true,
    authorizedAccess:true,
    authorizedEbuyAccess:true,
    accessEvidenceId:'TEST-AUTH-1',
    withinGrantedScope:true
  });
  assert.strictEqual(clientRestricted.allowed, true);
  assert.strictEqual(clientRestricted.badge, 'LIVE AUTHORIZED');

  const historical = universalPolicy.classify({ source:'USAspending award history', stage:'RECENT_SIMILAR_AWARD', sourceAccess:'PUBLIC_AWARD_HISTORY' }, {});
  assert.strictEqual(historical.allowed, true);
  assert.strictEqual(historical.evidenceLane, 'RECONSTRUCTED_INTELLIGENCE');
  assert.strictEqual(historical.live, false);

  const service = new DemoUnifiedOpportunityService();
  const demo = service.build({
    opportunities:{
      liveAndForecast:[
        { id:'sam-1', source:'SAM.gov', sourceAccess:'PUBLIC', stage:'OPEN', market:'FEDERAL', title:'Public test' },
        { id:'ebuy-1', source:'GSA eBuy', sourceAccess:'GATED', stage:'OPEN', market:'FEDERAL', title:'Restricted test' }
      ],
      similarRecentAwards:[
        { id:'award-1', source:'USAspending award history', title:'Recent similar award', market:'FEDERAL' }
      ]
    }
  });
  assert.strictEqual(demo.records.some(row => row.id === 'sam-1'), true);
  assert.strictEqual(demo.records.some(row => row.id === 'ebuy-1'), false);
  assert.strictEqual(demo.records.some(row => row.id === 'award-1'), true);
  assert.strictEqual(demo.sourceAccessGovernance.blockedUnauthorizedOrGatedRecords, 1);

  const processOnly = healthPolicy.evaluateLane({
    lane:'P2GC_DEMO',
    observedAt:new Date().toISOString(),
    processOnline:true,
    functionalProbe:false,
    semanticResult:false,
    dependencyStatus:true,
    freshnessStatus:true
  });
  assert.strictEqual(processOnly.green, false);

  const semanticGreen = healthPolicy.evaluateLane({
    lane:'P2GC_DEMO',
    observedAt:new Date().toISOString(),
    processOnline:true,
    functionalProbe:true,
    semanticResult:true,
    dependencyStatus:true,
    freshnessStatus:true
  });
  assert.strictEqual(semanticGreen.green, true);

  console.log('UNIVERSAL_GOVERNMENT_OPPORTUNITY_INDEX_POLICY_PASS');
})();
