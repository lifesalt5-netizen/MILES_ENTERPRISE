'use strict';
const assert = require('assert');
const Preview = require('../SERVICES/demo/DemoCommercialPreviewService');

const service = new Preview({ opportunities:5, recompetes:5, primePartners:5, buyers:5, competitors:5, vehicles:5 });
const model = {
  ok:true,
  profile:{
    companyName:'DE LUNE CORP',
    uei:'WDCVJGELGBB5',
    cage:'96WP9',
    gsaHolderVerified:true,
    gsaStatus:'CURRENT GSA MAS HOLDER',
    certifications:[],
    smallBusinessStatus:'SMALL BUSINESS'
  },
  currentState:{ samRegistration:true, certifications:[], smallBusinessStatus:'SMALL BUSINESS', stateLocalSales:0, awardCount:323 },
  awardHistory:{ summary:{ awardCount:323 } },
  readiness:{
    categories:{
      eligibility:{label:'Eligibility',score:60,checks:[{label:'SAM active'}]},
      registrations:{label:'Registrations',score:90,checks:[{label:'UEI present'}]},
      contractVehicles:{label:'Contract Vehicles',score:80,checks:[{label:'Current GSA MAS'}]},
      marketing:{label:'Marketing',score:100,checks:[{label:'Legacy persona'}]},
      positioning:{label:'Positioning',score:100,checks:[{label:'Legacy segment'}]}
    },
    overall:86
  },
  pathway:{ type:'GSA_ACTIVATION_PATHWAY', title:'GSA Activation & First-Order Pathway™', steps:['Pursue first order'] },
  revenue:{ current:{ federal:null, state:0, local:0, commercial:0 }, opportunity:{ status:'MODELED_REVENUE_WITHHELD_PENDING_STRUCTURED_EVIDENCE', modeledPotentialFederalRevenue:null, modeledGrowthOpportunity:null } },
  opportunities:{
    liveAndForecast:[
      { noticeId:'ABC', title:'DLA Barstow', agency:'DLA', dueDate:'2026-09-03', setAside:'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside', fitScore:88 },
      { noticeId:'DEF', title:'DLA Barstow', agency:'DLA', dueDate:'2026-09-03', setAside:'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside', fitScore:87 }
    ],
    recompetes:[]
  },
  buyerIntelligence:{ records:[
    { agency:'Department of Agriculture', historicalAwardValue:100, awardCount:2 },
    { agency:'Department of Agriculture', historicalAwardValue:50, awardCount:1 },
    { agency:'Department of Defense', historicalAwardValue:10, awardCount:1 }
  ]},
  agencyAlignment:{ agencies:[] },
  vehicles:{ current:['GSA MAS'], recommendations:['Activate and expand contract vehicle coverage'] },
  gaps:{ items:['CAGE present','Multiple vehicle coverage','Activate and expand contract vehicle coverage'] },
  recommendations:{
    immediate:['Address primary growth driver: Vehicle Gap','Position outreach around persona: Vehicle Gap Contractor','Use revenue leakage estimate of $17,477,834 as the commercial pain point'],
    vehicle:['Activate and expand contract vehicle coverage'],
    agency:[], partner:['Identify prime/sub partners to close vehicle and agency access gaps'], opportunity:[],
    growth:['Expand contract vehicle coverage and activate existing schedules.','Prioritize 2 recompete/incumbent-displacement signals']
  },
  primePartners:{ records:[], strategy:[] }, competitors:{ records:[] }, subcontracting:{ strategy:[] },
  truthIntegrity:{ blockers:[], conflicts:[], sourceCoverage:{sam:true} }
};

const out = service.apply(model);
assert.strictEqual(out.revenue.current.state, null);
assert.strictEqual(out.revenue.current.local, null);
assert.strictEqual(out.revenue.current.commercial, null);
assert.strictEqual(out.opportunities.liveAndForecast.length, 1, 'semantic duplicate notices must collapse');
assert.strictEqual(out.opportunities.liveAndForecast[0].directPursuitEligible, false);
assert.strictEqual(out.opportunities.liveAndForecast[0].eligibilityStatus, 'SET_ASIDE_ELIGIBILITY_NOT_CONFIRMED');
assert(out.opportunities.liveAndForecast[0].fitScore <= 49);
assert.strictEqual(out.agencyAlignment.agencies.filter(x=>x.agency==='Department of Agriculture').length,1);
assert.strictEqual(out.agencyAlignment.agencies[0].fitScore, null);
assert(Number.isFinite(out.agencyAlignment.agencies[0].historicalConcentrationPct));
assert(!out.readiness.categories.marketing, 'legacy marketing readiness must be suppressed');
assert(!out.readiness.categories.positioning, 'legacy positioning readiness must be suppressed');
assert(!out.recommendations.immediate.some(x=>/Vehicle Gap|revenue leakage/i.test(x)));
assert(!out.recommendations.growth.some(x=>/recompete|activate existing schedule|expand contract vehicle coverage/i.test(x)));
assert(!out.recommendations.partner.some(x=>/close vehicle and agency access gaps/i.test(x)));
assert(out.recommendations.vehicle.some(x=>/Optimize utilization of the confirmed current GSA MAS/i.test(x)));
assert(!out.gaps.items.some(x=>/CAGE present|Multiple vehicle coverage|Activate and expand contract vehicle coverage/i.test(x)));
assert.strictEqual(out.pathway.title,'Federal Growth Pathway™','established awardee must not be put in first-order pathway');
console.log('DEMO_CLIENT_TRUTH_BOUNDARY_TEST=GREEN');
