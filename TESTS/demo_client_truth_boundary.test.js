'use strict';
const assert = require('assert');
const Preview = require('../SERVICES/demo/DemoCommercialPreviewService');

const service = new Preview({ opportunities:5, recompetes:5, primePartners:5, buyers:5, competitors:5, vehicles:5 });
const model = {
  ok:true,
  profile:{
    companyName:'DE LUNE CORP',
    gsaHolderVerified:true,
    gsaStatus:'CURRENT GSA MAS HOLDER',
    certifications:[],
    smallBusinessStatus:'SMALL BUSINESS'
  },
  currentState:{ samRegistration:null, certifications:[], smallBusinessStatus:'SMALL BUSINESS', stateLocalSales:0 },
  revenue:{ current:{ federal:3733751, state:0, local:0, commercial:0 }, opportunity:{ status:'MODELED_REVENUE_WITHHELD_PENDING_STRUCTURED_EVIDENCE', modeledPotentialFederalRevenue:null, modeledGrowthOpportunity:null } },
  opportunities:{
    liveAndForecast:[
      { noticeId:'ABC', title:'DLA Barstow', agency:'DLA', dueDate:'2026-09-03', setAside:'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside', fitScore:88 },
      { noticeId:'ABC', title:'DLA Barstow', agency:'DLA', dueDate:'2026-09-03', setAside:'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside', fitScore:88 }
    ],
    recompetes:[]
  },
  buyerIntelligence:{ records:[
    { agency:'Department of Agriculture', historicalAwardValue:100, awardCount:2 },
    { agency:'Department of Agriculture', historicalAwardValue:50, awardCount:1 },
    { agency:'Department of Defense', historicalAwardValue:10, awardCount:1 }
  ]},
  agencyAlignment:{ agencies:[] },
  vehicles:{ current:['GSA MAS'], recommendations:['Address primary growth driver: Vehicle Gap'] },
  gaps:{ items:['SAM entity appears active','SAM active'] },
  recommendations:{
    immediate:['Address primary growth driver: Vehicle Gap','Position outreach around persona: Vehicle Gap Contractor','Use revenue leakage estimate of $17,477,834 as the commercial pain point'],
    vehicle:['Activate and expand contract vehicle coverage'],
    agency:[], partner:[], opportunity:[],
    growth:['Prioritize 2 recompete/incumbent-displacement signals']
  },
  primePartners:{ records:[], strategy:[] }, competitors:{ records:[] }, subcontracting:{ strategy:[] }
};

const out = service.apply(model);
assert.strictEqual(out.revenue.current.state, null);
assert.strictEqual(out.revenue.current.local, null);
assert.strictEqual(out.revenue.current.commercial, null);
assert.strictEqual(out.opportunities.liveAndForecast.length, 1);
assert.strictEqual(out.opportunities.liveAndForecast[0].directPursuitEligible, false);
assert.strictEqual(out.opportunities.liveAndForecast[0].eligibilityStatus, 'SET_ASIDE_ELIGIBILITY_NOT_CONFIRMED');
assert(out.opportunities.liveAndForecast[0].fitScore <= 49);
assert.strictEqual(out.agencyAlignment.agencies.filter(x=>x.agency==='Department of Agriculture').length,1);
assert(!out.recommendations.immediate.some(x=>/Vehicle Gap|revenue leakage/i.test(x)));
assert(!out.recommendations.growth.some(x=>/recompete/i.test(x)));
assert(!out.gaps.items.some(x=>/SAM entity appears active|SAM active/i.test(x)));
console.log('DEMO_CLIENT_TRUTH_BOUNDARY_TEST=GREEN');
