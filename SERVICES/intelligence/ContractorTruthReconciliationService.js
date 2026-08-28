'use strict';

const FACT_STATES = new Set(['CURRENT','HISTORICAL','STALE','MODELED','UNVERIFIED','SOURCE_UNAVAILABLE','NO_VERIFIED_MATCH','NOT_APPLICABLE']);
const MATERIAL_DOMAINS = ['identity','sam','awards','vehicles','certifications','naics','agencies','opportunities','recompetes'];

function norm(v) { return String(v ?? '').trim(); }
function upper(v) { return norm(v).toUpperCase(); }
function asArray(v) { return Array.isArray(v) ? v : []; }

function normalizeFact(fact = {}) {
  const state = upper(fact.state || 'UNVERIFIED');
  return {
    key: norm(fact.key),
    value: fact.value ?? null,
    state: FACT_STATES.has(state) ? state : 'UNVERIFIED',
    source: norm(fact.source),
    sourceId: norm(fact.sourceId),
    observedAt: norm(fact.observedAt),
    effectiveFrom: norm(fact.effectiveFrom),
    effectiveTo: norm(fact.effectiveTo),
    verified: Boolean(fact.verified),
    confidence: Number.isFinite(Number(fact.confidence)) ? Number(fact.confidence) : null,
    notes: norm(fact.notes)
  };
}

function isKnown(fact) {
  return fact && ['CURRENT','HISTORICAL','STALE','MODELED','NOT_APPLICABLE'].includes(fact.state);
}

function authoritative(fact) {
  return Boolean(fact && fact.verified && fact.source && ['CURRENT','HISTORICAL'].includes(fact.state));
}

function materialMissing(fact) {
  return !fact || ['UNVERIFIED','SOURCE_UNAVAILABLE','NO_VERIFIED_MATCH'].includes(fact.state);
}

function reconcileIdentity(identity = {}) {
  const legalName = norm(identity.legalName);
  const uei = upper(identity.uei);
  const cage = upper(identity.cage);
  const aliases = [...new Set(asArray(identity.aliases).map(norm).filter(Boolean))];
  const issues = [];
  if (!legalName) issues.push('LEGAL_NAME_UNRESOLVED');
  if (!uei && !cage) issues.push('UEI_AND_CAGE_UNRESOLVED');
  return { legalName, uei, cage, aliases, issues };
}

function detectContradictions(record) {
  const c = [];
  const facts = record.facts || {};
  const sam = facts.sam || {};
  const vehicles = facts.vehicles || {};
  const awards = facts.awards || {};

  if (authoritative(sam.active) && sam.active.value === true && authoritative(sam.registrationStatus) && upper(sam.registrationStatus.value) === 'INACTIVE') {
    c.push('SAM_ACTIVE_CONTRADICTS_REGISTRATION_STATUS');
  }
  if (authoritative(vehicles.gsaMas) && vehicles.gsaMas.value === true && authoritative(vehicles.hasContractVehicle) && vehicles.hasContractVehicle.value === false) {
    c.push('GSA_MAS_CONTRADICTS_NO_CONTRACT_VEHICLE');
  }
  if (authoritative(awards.totalFederalAwardValue) && Number(awards.totalFederalAwardValue.value) > 0 && authoritative(awards.hasFederalAwards) && awards.hasFederalAwards.value === false) {
    c.push('AWARD_VALUE_CONTRADICTS_NO_FEDERAL_AWARDS');
  }
  if (authoritative(awards.currentActiveAwardValue) && Number(awards.currentActiveAwardValue.value) === 0 && authoritative(awards.historicalAwardValue) && Number(awards.historicalAwardValue.value) > 0) {
    // This is not itself a contradiction. It is the Delune class: historical success must not be rendered as current strength.
  }
  return c;
}

function truthStateSummary(record) {
  const summary = { CURRENT:0, HISTORICAL:0, STALE:0, MODELED:0, UNVERIFIED:0, SOURCE_UNAVAILABLE:0, NO_VERIFIED_MATCH:0, NOT_APPLICABLE:0 };
  for (const domain of Object.values(record.facts || {})) {
    for (const fact of Object.values(domain || {})) {
      if (fact && summary[fact.state] !== undefined) summary[fact.state]++;
    }
  }
  return summary;
}

function reconcile(input = {}) {
  const identity = reconcileIdentity(input.identity || {});
  const facts = {};
  for (const [domain, entries] of Object.entries(input.facts || {})) {
    facts[domain] = {};
    for (const [key, raw] of Object.entries(entries || {})) facts[domain][key] = normalizeFact({ key, ...raw });
  }

  const record = {
    schema: 'P2GC_CANONICAL_CONTRACTOR_TRUTH_V1',
    generatedAt: new Date().toISOString(),
    identity,
    facts,
    crmContext: asArray(input.crmContext).map(x => ({
      statement: norm(x.statement),
      observedAt: norm(x.observedAt),
      source: norm(x.source || 'CRM'),
      status: upper(x.status || 'UNVERIFIED')
    })),
    recommendations: asArray(input.recommendations),
    contradictions: [],
    blockers: []
  };

  record.contradictions = detectContradictions(record);
  if (identity.issues.length) record.blockers.push(...identity.issues);

  for (const domain of MATERIAL_DOMAINS) {
    if (!facts[domain] || !Object.keys(facts[domain]).length) record.blockers.push(`MATERIAL_DOMAIN_UNRESOLVED:${domain}`);
  }
  if (record.contradictions.length) record.blockers.push('CROSS_MODULE_CONTRADICTION');

  record.truthStates = truthStateSummary(record);
  record.clientReady = record.blockers.length === 0 && record.truthStates.STALE === 0 && record.truthStates.SOURCE_UNAVAILABLE === 0 && record.truthStates.UNVERIFIED === 0;
  record.acceptance = record.clientReady ? 'READY' : 'FAIL_CLOSED';
  return record;
}

function assertRecommendationSafe(record, recommendation = {}) {
  const requiredFacts = asArray(recommendation.requiredFacts);
  const reasons = [];
  for (const ref of requiredFacts) {
    const [domain, key] = String(ref).split('.');
    const fact = record?.facts?.[domain]?.[key];
    if (!fact) reasons.push(`MISSING_FACT:${ref}`);
    else if (materialMissing(fact)) reasons.push(`UNVERIFIED_FACT:${ref}:${fact.state}`);
    else if (fact.state === 'STALE') reasons.push(`STALE_FACT:${ref}`);
  }
  if (record?.contradictions?.length) reasons.push('RECORD_HAS_CONTRADICTIONS');
  return { safe: reasons.length === 0, reasons };
}

module.exports = {
  FACT_STATES,
  MATERIAL_DOMAINS,
  normalizeFact,
  reconcileIdentity,
  reconcile,
  assertRecommendationSafe,
  authoritative,
  isKnown,
  materialMissing
};
