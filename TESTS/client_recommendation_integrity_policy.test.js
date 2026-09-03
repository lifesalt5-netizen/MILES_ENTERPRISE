'use strict';
const assert=require('assert');
const Policy=require('../SERVICES/demo/ClientRecommendationIntegrityPolicy');

const kebros={
  ok:true,
  profile:{gsaStatus:'CURRENT GSA MAS NON-HOLDER',contractVehicles:[]},
  currentState:{contractVehicles:[]},
  vehicles:{current:[],recommendations:['Activate and expand contract vehicle coverage']},
  opportunities:{recompetes:new Array(5).fill(0).map((_,i)=>({id:`R${i+1}`}))},
  revenue:{opportunity:{status:'ORION_MODELED_REVENUE_LEAKAGE_ESTIMATE',modeledGrowthOpportunity:4630204}},
  recommendations:{
    immediate:['Use revenue leakage estimate of $4,630,204 as the commercial pain point','Add secondary messaging: Vehicle Gap Contractor'],
    vehicle:['Activate and expand contract vehicle coverage'],
    agency:[],partner:[],opportunity:[],
    growth:['Prioritize 10 recompete/incumbent-displacement signals']
  },
  gaps:{items:[]}
};
Policy.apply(kebros);
assert(!JSON.stringify(kebros.recommendations).includes('4,630,204'));
assert(!JSON.stringify(kebros.recommendations).includes('Vehicle Gap Contractor'));
assert(!JSON.stringify(kebros.recommendations).includes('Prioritize 10 recompete'));
assert(kebros.recommendations.growth.some(x=>/Prioritize 5 validated recompete signals/i.test(x)));
assert(kebros.recommendations.vehicle.some(x=>/broader federal vehicle inventory validation/i.test(x)));

const holder={
  ok:true,
  profile:{gsaStatus:'CURRENT GSA MAS HOLDER',contractVehicles:['GSA MAS']},
  currentState:{contractVehicles:['GSA MAS']},vehicles:{current:['GSA MAS'],recommendations:['Activate existing schedule']},
  opportunities:{recompetes:[]},revenue:{opportunity:{status:'MODELED_REVENUE_WITHHELD_PENDING_STRUCTURED_EVIDENCE'}},
  recommendations:{immediate:[],vehicle:['Activate existing schedule'],agency:[],partner:[],opportunity:[],growth:[]},gaps:{items:[]}
};
Policy.apply(holder);
assert(!JSON.stringify(holder.recommendations).includes('Activate existing schedule'));
assert(holder.recommendations.vehicle.some(x=>/Map verified current vehicle scope/i.test(x)));

console.log('CLIENT_RECOMMENDATION_INTEGRITY_POLICY_TEST=GREEN');
