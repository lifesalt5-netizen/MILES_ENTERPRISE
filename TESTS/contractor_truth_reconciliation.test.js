'use strict';

const assert = require('assert');
const {
  reconcile,
  assertRecommendationSafe
} = require('../SERVICES/intelligence/ContractorTruthReconciliationService');

function current(value, source='AUTHORITATIVE') {
  return { value, state:'CURRENT', source, verified:true, observedAt:'2026-08-28T00:00:00Z' };
}
function historical(value, source='USASPENDING') {
  return { value, state:'HISTORICAL', source, verified:true, observedAt:'2026-08-28T00:00:00Z' };
}

const baseFacts = {
  identity: { legalName: current('Example Co') },
  sam: { active: current(true), registrationStatus: current('ACTIVE') },
  awards: { hasFederalAwards: current(true), historicalAwardValue: historical(1000000), currentActiveAwardValue: current(0), totalFederalAwardValue: historical(1000000) },
  vehicles: { gsaMas: current(true), hasContractVehicle: current(true) },
  certifications: { status: current('VERIFIED') },
  naics: { primary: current('541512') },
  agencies: { historicalBuyers: historical(['HHS']) },
  opportunities: { currentMatches: current([]) },
  recompetes: { currentSignals: current([]) }
};

{
  const r = reconcile({
    identity: { legalName:'Example Co', uei:'ABC123', cage:'1A2B3' },
    facts: baseFacts
  });
  assert.equal(r.acceptance, 'READY');
  assert.equal(r.facts.awards.historicalAwardValue.state, 'HISTORICAL');
  assert.equal(r.facts.awards.currentActiveAwardValue.value, 0);
}

{
  const facts = JSON.parse(JSON.stringify(baseFacts));
  facts.vehicles.hasContractVehicle = current(false);
  const r = reconcile({ identity:{ legalName:'Example Co', uei:'ABC123' }, facts });
  assert(r.contradictions.includes('GSA_MAS_CONTRADICTS_NO_CONTRACT_VEHICLE'));
  assert.equal(r.acceptance, 'FAIL_CLOSED');
}

{
  const facts = JSON.parse(JSON.stringify(baseFacts));
  facts.awards.currentActiveAwardValue = { value:null, state:'SOURCE_UNAVAILABLE', source:'USASPENDING', verified:false };
  const r = reconcile({ identity:{ legalName:'Example Co', uei:'ABC123' }, facts });
  assert.equal(r.acceptance, 'FAIL_CLOSED');
  assert.equal(r.facts.awards.currentActiveAwardValue.state, 'SOURCE_UNAVAILABLE');
}

{
  const r = reconcile({
    identity:{ legalName:'Delune-like Co', uei:'DELUNE1' },
    facts: baseFacts,
    crmContext:[{ statement:'COVID-era awards are running out and replacement revenue is needed', observedAt:'2026-01-01', source:'CRM', status:'VERIFIED' }]
  });
  const check = assertRecommendationSafe(r, { requiredFacts:['awards.historicalAwardValue','awards.currentActiveAwardValue','naics.primary'] });
  assert.equal(check.safe, true);
  assert.equal(r.facts.awards.historicalAwardValue.state, 'HISTORICAL');
  assert.equal(r.facts.awards.currentActiveAwardValue.state, 'CURRENT');
}

{
  const facts = JSON.parse(JSON.stringify(baseFacts));
  facts.opportunities.currentMatches = { value:null, state:'UNVERIFIED', source:'', verified:false };
  const r = reconcile({ identity:{ legalName:'Example Co', uei:'ABC123' }, facts });
  const check = assertRecommendationSafe(r, { requiredFacts:['opportunities.currentMatches'] });
  assert.equal(check.safe, false);
  assert(check.reasons.some(x => x.startsWith('UNVERIFIED_FACT:opportunities.currentMatches')));
}

console.log('CONTRACTOR_TRUTH_RECONCILIATION_TEST_PASS');
