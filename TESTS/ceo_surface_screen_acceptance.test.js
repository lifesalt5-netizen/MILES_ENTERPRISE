'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function section(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => console.log(`PASS ${name}`));
    }
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
    throw error;
  }
}

function representativeModel() {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    profile: {
      companyName: 'Acceptance Federal LLC',
      uei: 'ACCEPT123456',
      cage: '1ABC2',
      naicsCodes: ['541512'],
      certifications: ['SDVOSB'],
      samStatus: 'ACTIVE',
      gsaStatus: 'ACTIVE',
      contractVehicles: ['GSA MAS']
    },
    readiness: { overall: 82, categories: { contractVehicles: { score: 76 } } },
    evidence: { source: 'ACCEPTANCE_FIXTURE', disclosure: 'Validate modeled signals before external reliance.' },
    safety: { readOnly: true, writesEnabled: false },
    opportunities: {
      liveAndForecast: [{ id: 'OPP-1', title: 'Cyber support', agency: 'Agency A', source: 'https://example.com/opp', status: 'OPEN', dueDate: '2026-09-30' }],
      recompetes: [{ id: 'REC-1', title: 'Enterprise recompete', agency: 'Agency B', source: 'https://example.com/rec' }]
    },
    agencyAlignment: { agencies: [{ agency: 'Agency A', fitScore: 90, historicalSpend: 1000000, awardCount: 5 }] },
    recommendations: { opportunity: ['Qualify OPP-1'], immediate: ['Validate due date'], partner: ['Validate partner'] },
    vehicles: { status: 'CURRENT_VEHICLES_IDENTIFIED', current: ['GSA MAS'], recommendations: ['Validate HACS eligibility'] },
    gaps: { items: ['HACS vehicle/SIN gap'] },
    pathway: { type: 'GROWTH_PATHWAY', title: 'Growth Pathway' },
    primePartners: {
      records: [{ company: 'Prime One', uei: 'PRIME1', vehicle: 'GSA MAS', agencies: ['Agency A'], federalRevenue: 10000000, awardCount: 10, basis: 'shared NAICS', confidence: 'MODELED_CANDIDATE' }],
      strategy: ['Validate Prime One']
    },
    subcontracting: { status: 'ORION_TEAMING_SIGNALS_AVAILABLE', records: [{ title: 'Teaming signal', prime: 'Prime One', source: 'ORION' }] },
    competitors: { status: 'ORION_MARKET_PEER_MODEL' }
  };
}

async function main() {
  await section('CEO dashboard exposes every visible operating box and unified routes', () => {
    const html = read('SERVICES/ceo_dashboard/public/index.html');
    for (const id of ['scoreGrid','refreshBrief','briefStatus','briefBody','commandText','sendCommand','commandResult','approvals','alerts','marketing','orion','work','activity']) {
      assert(html.includes(`id="${id}"`), `missing dashboard control/box ${id}`);
    }
    for (const route of ['/demo','/teaming','/opportunities','/vehicles','/recompetes','/proposal-command','/execution','/legacy']) {
      assert(html.includes(`href="${route}"`), `dashboard must use unified route ${route}`);
    }
    assert(!html.includes('127.0.0.1:8791'), 'CEO-facing dashboard must not expose product backend port 8791');
    assert(!html.includes('live 8787 execution engine'), 'dashboard copy must not describe public gateway as execution backend');
    assert(html.includes('unified MILES control surface'), 'dashboard should describe command routing through unified control surface');
  });

  await section('CEO dashboard JavaScript wires state, brief, command and refresh actions', () => {
    const js = read('SERVICES/ceo_dashboard/public/ceo.js');
    for (const contract of ['getJson("/api/state")','getJson("/api/brief")','getJson("/api/command"','refreshBrief','sendCommand','loadState','loadBrief']) {
      assert(js.includes(contract), `missing dashboard JS contract ${contract}`);
    }
    assert(js.includes('setInterval'), 'dashboard must refresh live state periodically');
  });

  await section('Growth Blueprint screen exposes all promised controls and output boxes', () => {
    const html = read('SERVICES/demo/public/index.html');
    for (const id of ['term','analyze','refresh','print','download','companyName','overallScore','readinessGrid','currentState','gaps','revenueCards','vehicles','agencies','competitors','primes','subcontracting','buyers','opportunities','recompetes','pathway','recommendations']) {
      assert(html.includes(`id="${id}"`), `Growth Blueprint missing ${id}`);
    }
    assert(html.includes('/api/assessment') || read('SERVICES/demo/public/app.js').includes('/api/assessment'), 'Growth Blueprint must call assessment API');
    assert(/Validate modeled signals/i.test(html), 'Growth Blueprint must show evidence limitation');
  });

  await section('Sub2Prime screen exposes input, prime, agency, teaming, actions and evidence disclosure', () => {
    const html = read('SERVICES/demo/public/teaming.html');
    for (const id of ['term','analyze','companyName','readiness','status','primes','agencies','signals','actions','disclosure']) {
      assert(html.includes(`id="${id}"`), `Sub2Prime missing ${id}`);
    }
    assert(html.includes('/api/teaming?term='), 'Sub2Prime must call teaming API');
    assert(/does not invent SBLO names, email addresses, phone numbers/i.test(html), 'Sub2Prime must preserve no-contact-fabrication rule');
  });

  await section('Opportunity Vehicle and Recompete screen exposes common focused-intelligence controls', () => {
    const html = read('SERVICES/demo/public/intelligence.html');
    for (const id of ['term','analyze','pageTitle','companyName','readiness','status','primary','secondary','actions','disclosure','capability']) {
      assert(html.includes(`id="${id}"`), `Focused intelligence missing ${id}`);
    }
    assert(html.includes('mode=location.pathname.includes("vehicles")'), 'Vehicle route must select vehicle mode');
    assert(html.includes('location.pathname.includes("recompetes")'), 'Recompete route must select recompete mode');
    assert(html.includes('/api/intelligence?type='), 'Focused intelligence must call semantic API');
    assert(/fails closed on incumbent identity/i.test(html), 'Recompete UI must disclose fail-closed incumbent coverage');
  });

  await section('Focused intelligence returns correct semantic result types and fails closed', () => {
    const P2GCFocusedIntelligenceService = require('../SERVICES/demo/P2GCFocusedIntelligenceService');
    const focused = new P2GCFocusedIntelligenceService();
    const model = representativeModel();

    const opportunities = focused.build('opportunities', model);
    assert.equal(opportunities.ok, true);
    assert.equal(opportunities.type, 'opportunities');
    assert.equal(opportunities.prospect.companyName, model.profile.companyName);
    assert.equal(opportunities.records[0].title, 'Cyber support');
    assert.equal(typeof opportunities.disclosure, 'string');

    const vehicles = focused.build('vehicles', model);
    assert.equal(vehicles.ok, true);
    assert.equal(vehicles.type, 'vehicles');
    assert.deepStrictEqual(vehicles.currentVehicles, ['GSA MAS']);
    assert(vehicles.vehicleGaps.some(item => /HACS/i.test(item)));

    const recompetes = focused.build('recompetes', model);
    assert.equal(recompetes.ok, true);
    assert.equal(recompetes.type, 'recompetes');
    assert.equal(recompetes.records[0].id, 'REC-1');
    assert.equal(recompetes.currentCapability.incumbentIdentity, false);

    const noSignals = focused.build('opportunities', { ...model, opportunities: { liveAndForecast: [], recompetes: [] } });
    assert.equal(noSignals.status, 'NO_CURRENT_MATCHED_OPPORTUNITY_SIGNAL');
    assert.deepStrictEqual(noSignals.records, []);
  });

  await section('Sub2Prime returns ranked evidence and never invents a contact', () => {
    const P2GCPrimeSubTeamingService = require('../SERVICES/teaming/P2GCPrimeSubTeamingService');
    const model = representativeModel();
    const fakeBlueprint = { build: () => model };
    const service = new P2GCPrimeSubTeamingService({ blueprintService: fakeBlueprint });
    const result = service.build(model.profile.companyName);
    assert.equal(result.ok, true);
    assert.equal(result.prospect.companyName, model.profile.companyName);
    assert.equal(result.primeCandidates[0].company, 'Prime One');
    assert.equal(result.primeCandidates[0].contact.email, null);
    assert.equal(result.safety.contactsInvented, false);
    assert(result.targetAgencies.some(item => item.agency === 'Agency A'));
  });

  await section('Proposal Command screen and service fail closed without submission proof', () => {
    const html = read('SERVICES/demo/public/proposal-command.html');
    assert(/Proposal Command/i.test(html));
    assert(html.includes('/api/proposal-command/health') || read('SERVICES/demo/public/proposal-command.js').includes('/api/proposal-command/health'));
    assert(html.includes('/api/proposal-command/run') || read('SERVICES/demo/public/proposal-command.js').includes('/api/proposal-command/run'));

    const proposal = require('../SERVICES/proposal/P2GCProposalCommandService');
    const result = proposal.run({
      solicitation: {
        id: 'RFP-ACCEPT-1',
        title: 'Acceptance Test Solicitation',
        sourceUrl: 'https://example.com/rfp',
        currentVersion: '1',
        mandatoryRequirements: [{ id: 'REQ-1', description: 'Provide technical approach', mandatory: true }]
      },
      client: { name: 'Acceptance Federal LLC' }
    });
    assert.equal(result.ok, true);
    assert(result.stages.length >= 10, 'proposal pipeline should expose complete controlled stages');
    assert.equal(result.packaging.submitted, false);
    assert.equal(result.packaging.submissionProof, null);
    assert.notEqual(result.packaging.submissionReadiness, 'SUBMITTED');
    assert(JSON.stringify(result).includes('Never mark SUBMITTED without actual external submission proof'));
  });

  await section('Customer Revenue Operations computes CRM, meetings and revenue from persisted evidence only', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-customer-acceptance-'));
    process.env.P2GC_CUSTOMER_DATA_DIR = temp;
    const modulePath = require.resolve('../SERVICES/customer/P2GCCustomerDeliveryService');
    delete require.cache[modulePath];
    const customer = require('../SERVICES/customer/P2GCCustomerDeliveryService');

    const prospect = customer.upsertProspect({
      company: 'Acceptance Federal LLC',
      email: 'acceptance@example.com',
      source: 'TEST',
      segment: 'GSA_GROWTH',
      nextAction: 'Schedule discovery',
      meetingAt: '2099-01-01T15:00:00.000Z',
      pipelineValue: 7000
    }).prospect;
    assert(prospect.id);

    const meeting = customer.meetingPipeline();
    assert.equal(meeting.ok, true);
    assert.equal(meeting.metrics.meetingsBooked, 1);
    assert.equal(meeting.metrics.upcoming, 1);

    const revenue = customer.revenueCommandCenter();
    assert.equal(revenue.ok, true);
    assert.equal(revenue.metrics.pipelineValue, 7000);
    assert.equal(revenue.metrics.prospects, 1);

    const health = customer.healthCheck();
    assert.equal(health.ok, true);
    assert.equal(health.billing.externalChargeEnabled, false);
    assert.equal(health.billing.externalChargeStatus, 'FAIL_CLOSED_UNTIL_PAYMENT_PROVIDER_CONFIGURED');
  });

  await section('MILES execution screen preserves answer state and evidence-backed response path', () => {
    const html = read('SERVICES/digital_coo/public/index.html');
    const js = read('SERVICES/digital_coo/public/app.js');
    const service = read('SERVICES/ExecutiveResponseService.js');
    assert(/Miles Command Center/.test(html));
    assert(js.includes('Miles answered your question'));
    assert(service.includes('emailPerformanceAdvisory'));
    assert(service.includes('Best plan to get more meetings:'));
    assert(!service.includes('Executive response received'));
  });

  await section('Unified gateway owns every CEO-facing page/API route', () => {
    const gateway = require('../SERVICES/digital_coo/UnifiedMilesGateway');
    for (const route of ['/demo','/teaming','/opportunities','/vehicles','/recompetes','/proposal-command']) {
      assert(gateway.PRODUCT_PAGE_PATHS.has(route), `${route} missing from product route set`);
    }
    assert(gateway.matchesPrefix('/api/state', gateway.DASHBOARD_API_PREFIXES));
    assert(gateway.matchesPrefix('/api/brief', gateway.DASHBOARD_API_PREFIXES));
    assert(gateway.matchesPrefix('/api/command', gateway.COMMAND_API_PREFIXES));
    assert(gateway.matchesPrefix('/api/assessment', gateway.PRODUCT_API_PREFIXES));
    assert(gateway.matchesPrefix('/api/teaming', gateway.PRODUCT_API_PREFIXES));
    assert(gateway.matchesPrefix('/api/intelligence', gateway.PRODUCT_API_PREFIXES));
    assert(gateway.matchesPrefix('/api/proposal-command/run', gateway.PRODUCT_API_PREFIXES));
  });

  console.log('CEO_SURFACE_SCREEN_ACCEPTANCE=GREEN');
}

main().catch(error => {
  console.error('CEO_SURFACE_SCREEN_ACCEPTANCE=RED');
  console.error(error.stack || error.message);
  process.exit(1);
});
