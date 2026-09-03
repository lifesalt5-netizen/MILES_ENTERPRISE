'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const probe = require('../SCRIPTS/ProbeLiveDemoCanonicalCompany');

const model = {
  ok: true,
  profile: {
    companyName: 'Acceptance Federal LLC',
    uei: 'TESTUEI12345',
    cage: '1TEST',
    samStatus: 'ACTIVE',
    naicsCodes: ['541519'],
    certifications: [],
    gsaStatus: 'CURRENT GSA MAS HOLDER',
    gsaEvidenceStatus: 'CURRENT_GSA_MAS_HOLDER_CONFIRMED',
    gsaHolderVerified: true,
    gsaContracts: [{
      contractNumber: '47TEST25D0001',
      categories: ['54151S'],
      currentOptionPeriodEndDate: '2030-04-23',
      ultimateContractEndDate: '2045-04-23',
      socioEconomicIndicators: 'Small Business',
      sourceStatus: 'LIVE_GSA_ELIBRARY',
      sourceUrl: 'https://gsaelibrary.gsa.gov/'
    }]
  },
  truthIntegrity: {
    status: 'CANONICAL_CURRENT_TRUTH_RECONCILED',
    clientSafe: true,
    conflicts: [],
    blockers: [],
    warnings: [],
    sourceCoverage: {
      identity: true,
      sam: true,
      awardHistory: true,
      gsaCurrent: true,
      currentPublicOpportunities: true,
      currentObligationAggregate: false
    }
  },
  currentState: {
    awardCount: 2,
    currentPerformancePrimeAwardCount: 1,
    activeContracts: null,
    activeContractsStatus: 'NOT_DERIVED_FROM_AWARD_COUNT'
  },
  awardHistory: {
    status: 'CONFIRMED_USASPENDING_AWARD_HISTORY',
    truthClass: 'CONFIRMED',
    summary: { awardCount: 2, primeAwardCount: 2, subcontractAwardCount: 0, activePrimeAwardCount: 1 },
    primeAwards: [{ role: 'PRIME', awardId: 'A1' }],
    subcontracts: []
  },
  buyerIntelligence: {
    status: 'CONFIRMED_USASPENDING_BUYER_HISTORY',
    records: [{ agency: 'GSA', buyer: 'FAS', historicalAwardValue: 500000, awardCount: 2 }]
  },
  opportunities: {
    sourceCoverage: { status: 'CURRENT_PUBLIC_OPPORTUNITY_CANDIDATES_AVAILABLE', fresh: true },
    liveAndForecast: [{ title: 'Current Opportunity', agency: 'GSA', stage: 'OPEN', naics: '541519', dueDate: '2026-10-01', source: 'SAM.gov' }],
    recompetes: []
  },
  revenue: {
    current: { federal: null, federalStatus: 'CURRENT_OBLIGATION_TOTAL_UNAVAILABLE_HISTORICAL_AWARDS_EXIST', federalDefinition: 'Historical awards exist; current obligations unavailable.' },
    opportunity: { modeledPotentialFederalRevenue: null, modeledGrowthOpportunity: null, status: 'MODELED_REVENUE_WITHHELD_PENDING_STRUCTURED_EVIDENCE' }
  },
  pathway: { type: 'FEDERAL_GROWTH_PATHWAY', title: 'Federal Growth Pathway™' },
  competitors: { records: [{ company: 'Peer A' }, { company: 'Peer B' }] },
  primePartners: { records: [{ company: 'Prime A' }, { company: 'Prime B' }] }
};

const good = probe.summarize(model);
assert.strictEqual(good.ok, true);
assert.strictEqual(good.gsa.contractNumbers[0], '47TEST25D0001');
assert.deepStrictEqual(good.gsa.categoriesOrSins, ['54151S']);
assert.strictEqual(good.awards.clientActiveContracts, null);
assert.strictEqual(good.quality.clientActiveContractTruthBoundaryPreserved, true);
assert.strictEqual(good.opportunities.zeroAwardPlaceholderCount, 0);
assert.deepStrictEqual(good.quality.duplicateCompetitors, []);
assert.deepStrictEqual(good.acceptanceFailures, []);

const missingSin = JSON.parse(JSON.stringify(model));
missingSin.profile.gsaContracts[0].categories = [];
const badSin = probe.summarize(missingSin);
assert.strictEqual(badSin.ok, false);
assert(badSin.acceptanceFailures.includes('GSA_HOLDER_WITHOUT_CATEGORY_OR_SIN_DETAIL'));

const fakeRecompete = JSON.parse(JSON.stringify(model));
fakeRecompete.opportunities.recompetes = [{ title: 'ZERO_AWARD_VENDOR placeholder' }];
const badRecompete = probe.summarize(fakeRecompete);
assert.strictEqual(badRecompete.ok, false);
assert(badRecompete.acceptanceFailures.includes('ZERO_AWARD_VENDOR_RECOMPETE_PLACEHOLDER_RENDERED'));

const duplicatePeer = JSON.parse(JSON.stringify(model));
duplicatePeer.competitors.records.push({ company: 'Peer A' });
const badDuplicate = probe.summarize(duplicatePeer);
assert.strictEqual(badDuplicate.ok, false);
assert(badDuplicate.acceptanceFailures.some(x => x.startsWith('DUPLICATE_COMPETITORS:')));

const activeLeak = JSON.parse(JSON.stringify(model));
activeLeak.currentState.activeContracts = 2;
activeLeak.currentState.activeContractsStatus = 'CONFIRMED_CURRENT_PERFORMANCE_PERIOD_FROM_USASPENDING_DATES';
const badBoundary = probe.summarize(activeLeak);
assert.strictEqual(badBoundary.ok, false);
assert(badBoundary.acceptanceFailures.includes('CLIENT_ACTIVE_CONTRACT_FIELD_MUST_REMAIN_UNCLAIMED'));

const reconciliationSource = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'ReconcileProductionTruth.js'), 'utf8');
assert(reconciliationSource.includes("P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS = '180000'"));
assert(reconciliationSource.includes("runNode('AuditLiveP2GCDemoAcceptance.js', [], 900000)"));
assert(reconciliationSource.includes("runNode('ProbeLiveDemoCanonicalCompany.js', [], 300000)"));

console.log('LIVE_DEMO_CANONICAL_COMPANY_PROBE_TEST=GREEN');
