'use strict';

const assert = require('assert');
const audit = require('../SCRIPTS/AuditLiveP2GCDemoAcceptance');

function goodAssessment() {
  const truthIntegrity = {
    status: 'RECONCILED_FROM_AVAILABLE_EVIDENCE',
    clientSafe: true,
    conflicts: [],
    warnings: []
  };
  return {
    ok: true,
    profile: { companyName: 'Acceptance Federal LLC' },
    currentState: { activeContracts: null, activeContractsStatus: 'NOT_DERIVED_FROM_AWARD_COUNT' },
    truthIntegrity,
    evidence: { truthIntegrity }
  };
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
    safety: { readOnly: true, writesEnabled: false, contactsInvented: false }
  };
}

function main() {
  assert.ok(audit.DEFAULT_COMPANIES.includes('DeLune Corporation'));
  assert.ok(audit.DEFAULT_COMPANIES.length >= 5);

  let failures = [];
  audit.validateAssessment(goodAssessment(), failures);
  audit.validateOpportunities(goodOpportunities(), failures);
  audit.validateVehicles(goodVehicles(), failures);
  audit.validateRecompetes(goodRecompetes(), failures);
  audit.validateTeaming(goodTeaming(), failures);
  assert.deepStrictEqual(failures, []);

  failures = [];
  const conflicted = goodAssessment();
  conflicted.truthIntegrity = { status: 'CONFLICTED_REVIEW_REQUIRED', clientSafe: false, conflicts: ['TEST_CONFLICT'] };
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

main();
