'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const audit = require('../SCRIPTS/AuditLiveP2GCDemoAcceptance');

function goodAssessment() {
  const truthIntegrity = {
    status: 'CANONICAL_CURRENT_TRUTH_RECONCILED',
    clientSafe: true,
    conflicts: [],
    warnings: [],
    sourceCoverage: { identity:true, sam:true, awardHistory:true, gsaCurrent:true, currentPublicOpportunities:true }
  };
  return {
    ok: true,
    profile: { companyName: 'Acceptance Federal LLC' },
    currentState: { activeContracts: null, activeContractsStatus: 'UNVERIFIED', federalSales:null, federalSalesStatus:'CURRENT_OBLIGATION_TOTAL_UNAVAILABLE_HISTORICAL_AWARDS_EXIST' },
    awardHistory: { truthClass:'CONFIRMED', summary:{awardCount:2}, activePrimeAwards:[] },
    pathway: { type:'FEDERAL_GROWTH_PATHWAY' },
    truthIntegrity,
    evidence: { truthIntegrity }
  };
}

function goodConfirmedActiveAssessment() {
  const body = goodAssessment();
  body.currentState.activeContracts = 2;
  body.currentState.activeContractsStatus = 'CONFIRMED_CURRENT_PERFORMANCE_PERIOD_FROM_USASPENDING_DATES';
  body.awardHistory.activePrimeAwards = [{awardId:'A1'},{awardId:'A2'}];
  return body;
}

function goodAuthoritativeZeroAssessment() {
  const body = goodAssessment();
  body.currentState.federalSales = 0;
  body.currentState.federalSalesStatus = 'ZERO_PERMITTED_BY_AUTHORITATIVE_ZERO_AWARD_HISTORY';
  body.awardHistory.summary.awardCount = 0;
  body.pathway.type = 'FIRST_AWARD_PATHWAY';
  return body;
}

function goodOpportunities() {
  return {
    ok: true,
    type: 'opportunities',
    status: 'NO_CURRENT_MATCHED_OPPORTUNITY_SIGNAL',
    universalStatus: 'NO_QUALIFIED_PUBLIC_OPPORTUNITY_OR_HISTORY_SIGNAL',
    records: [],
    taxonomy: {
      markets: ['FEDERAL','SLED','LOCAL'],
      stages: ['OPEN','RFI','SOURCES_SOUGHT','PRESOLICITATION','DRAFT','FORECAST','RECOMPETE','RECENT_SIMILAR_AWARD','SPECIAL_NOTICE','UNKNOWN']
    },
    sourceAccessGovernance: { prospectDemo: true },
    opportunityRules: { bypassAuthentication: false, bypassAccessControls: false }
  };
}

function goodVehicles() {
  return { ok: true, type: 'vehicles', status: 'VEHICLE_STATUS_UNCONFIRMED', currentVehicles: [] };
}

function goodRecompetes() {
  return { ok: true, type: 'recompetes', status: 'NO_CURRENT_RECOMPETE_SIGNAL', records: [], currentCapability: { incumbentIdentity: false } };
}

function goodTeaming() {
  return {
    ok: true,
    status: 'TEAMING_INTELLIGENCE_LIMITED',
    primeCandidates: [],
    subcontractingOpportunities:{records:[]},
    safety: { readOnly: true, writesEnabled: false, contactsInvented: false }
  };
}

async function main() {
  assert.ok(audit.DEFAULT_COMPANIES.includes('DeLune Corporation'));
  assert.ok(audit.DEFAULT_COMPANIES.length >= 5);
  assert.strictEqual(audit.DEMO_PM2_NAME, 'p2gc-growth-demo');
  assert.ok(audit.DEMO_SOURCE_FILES.includes('StartP2GCGrowthBlueprintDemo.js'));
  assert.ok(audit.DEMO_SOURCE_FILES.includes('SERVICES/demo/ExecutiveBlueprintCanonicalTruthService.js'));
  assert.strictEqual(typeof audit.ensureDemoCurrent, 'function');
  assert.strictEqual(typeof audit.latestDemoSourceMtimeMs, 'function');
  assert.deepStrictEqual(audit.parsePm2List('[{"name":"p2gc-growth-demo"}]'), [{ name: 'p2gc-growth-demo' }]);
  assert.deepStrictEqual(audit.parsePm2List('not-json'), []);

  const source = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AuditLiveP2GCDemoAcceptance.js'), 'utf8');
  assert(source.includes('/api/assessment?term=${encoded}&refresh=1'), 'Each company must perform one explicit canonical refresh');
  assert(!source.includes('type=opportunities&refresh=1'), 'Opportunity view must reuse the freshly cached company model');
  assert(!source.includes('type=vehicles&refresh=1'), 'Vehicle view must reuse the freshly cached company model');
  assert(!source.includes('type=recompetes&refresh=1'), 'Recompete view must reuse the freshly cached company model');
  assert(!source.includes('/api/teaming?term=${encoded}&refresh=1'), 'Teaming view must reuse the freshly cached company model');

  if (process.platform !== 'win32') {
    const currency = await audit.ensureDemoCurrent();
    assert.equal(currency.ok, true);
    assert.equal(currency.skipped, true);
    assert.equal(currency.reason, 'WINDOWS_ONLY_PM2_RELOAD');
    assert.equal(currency.restartPerformed, false);
  }

  let failures = [];
  audit.validateAssessment(goodAssessment(), failures);
  audit.validateAssessment(goodConfirmedActiveAssessment(), failures);
  audit.validateAssessment(goodAuthoritativeZeroAssessment(), failures);
  audit.validateOpportunities(goodOpportunities(), failures);
  audit.validateVehicles(goodVehicles(), failures);
  audit.validateRecompetes(goodRecompetes(), failures);
  audit.validateTeaming(goodTeaming(), failures);
  assert.deepStrictEqual(failures, []);

  failures = [];
  const badActive = goodConfirmedActiveAssessment();
  badActive.currentState.activeContractsStatus = 'NOT_DERIVED_FROM_AWARD_COUNT';
  audit.validateAssessment(badActive, failures);
  assert.ok(failures.some(x => x.startsWith('ACTIVE_CONTRACTS_NON_NULL_WITHOUT_AUTHORITATIVE_STATUS')));

  failures = [];
  const badZero = goodAuthoritativeZeroAssessment();
  badZero.currentState.federalSalesStatus = 'UNKNOWN';
  audit.validateAssessment(badZero, failures);
  assert.ok(failures.some(x => x.startsWith('FEDERAL_ZERO_WITHOUT_AUTHORITATIVE_ZERO_CLASSIFICATION')));

  failures = [];
  const badFirstAward = goodAssessment();
  badFirstAward.awardHistory = { truthClass:'UNKNOWN', summary:null, activePrimeAwards:[] };
  badFirstAward.pathway = { type:'FIRST_AWARD_PATHWAY' };
  audit.validateAssessment(badFirstAward, failures);
  assert.ok(failures.some(x => x.startsWith('FIRST_AWARD_PATHWAY_WITHOUT_CONFIRMED_ZERO_AWARD_HISTORY')));

  failures = [];
  const conflicted = goodAssessment();
  conflicted.truthIntegrity = { status: 'CONFLICTED_REVIEW_REQUIRED', clientSafe: false, conflicts: ['TEST_CONFLICT'], sourceCoverage:{identity:true,sam:true,awardHistory:true,gsaCurrent:true,currentPublicOpportunities:true} };
  conflicted.evidence.truthIntegrity = conflicted.truthIntegrity;
  audit.validateAssessment(conflicted, failures);
  assert.ok(failures.some(x => x.startsWith('TRUTH_INTEGRITY_NOT_CLIENT_SAFE')));
  assert.ok(failures.some(x => x.startsWith('TRUTH_CONFLICTS_PRESENT')));

  failures = [];
  const unlabeledEmpty = goodOpportunities();
  unlabeledEmpty.status = 'AVAILABLE';
  unlabeledEmpty.universalStatus = 'AVAILABLE';
  audit.validateOpportunities(unlabeledEmpty, failures);
  assert.ok(failures.some(x => x.startsWith('EMPTY_OPPORTUNITY_VIEW_NOT_EXPLICIT_NO_FIT')));
  assert.ok(failures.some(x => x.startsWith('EMPTY_UNIVERSAL_INDEX_NOT_EXPLICIT_COVERAGE_STATE')));

  failures = [];
  const authBypass = goodOpportunities();
  authBypass.opportunityRules.bypassAuthentication = true;
  audit.validateOpportunities(authBypass, failures);
  assert.ok(failures.some(x => x === 'AUTH_BYPASS_POLICY_NOT_FALSE'));

  failures = [];
  const inventedContact = goodTeaming();
  inventedContact.status = 'TEAMING_INTELLIGENCE_READY';
  inventedContact.primeCandidates = [{ company: 'Prime One', contact: { status: 'UNAVAILABLE_IN_CURRENT_ORION_RECORD', email: 'invented@example.com' } }];
  audit.validateTeaming(inventedContact, failures);
  assert.ok(failures.some(x => x.startsWith('TEAMING_CONTACT_INVENTED')));

  console.log('LIVE_P2GC_DEMO_ACCEPTANCE_TEST: GREEN');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});