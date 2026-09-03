'use strict';
const assert=require('assert');
const Gap=require('../SERVICES/demo/OpportunityQualificationGapService');

const direct=Gap.analyze({
  title:'CWMS Database Authorization Maintenance and Improvements',
  capability:{directFit:true,scopeClass:'IT_TECHNOLOGY'},
  setAsideFit:{}
});
assert.strictEqual(direct.state,'PRELIMINARY_DIRECT_FIT_SUPPORTED');
assert.strictEqual(direct.materialGapCount,0);

const electrical=Gap.analyze({
  title:'Electrical Preventive Maintenance and Repair Services',
  capability:{directFit:false,scopeClass:'SPECIALIZED_MAINTENANCE'},
  setAsideFit:{}
});
assert.strictEqual(electrical.state,'NEAR_FIT_SINGLE_CAPABILITY_GAP');
assert.strictEqual(electrical.nearFit,true);
assert.strictEqual(electrical.materialGapCount,1);
assert(/electrical/i.test(electrical.singleGap.requirement));
assert(electrical.closureOptions.some(x=>/subcontractor|teaming partner/i.test(x)));

const sdvosb=Gap.analyze({
  title:'IT Support Services',
  capability:{directFit:true,scopeClass:'IT_TECHNOLOGY'},
  setAsideFit:{eligibilityBlocked:true,reason:'SDVOSB set-aside requires current certification validation'}
});
assert.strictEqual(sdvosb.state,'NEAR_FIT_SINGLE_ELIGIBILITY_GAP');
assert.strictEqual(sdvosb.materialGapCount,1);

const multiple=Gap.analyze({
  title:'HVAC Maintenance',
  capability:{directFit:false,scopeClass:'SPECIALIZED_MAINTENANCE'},
  setAsideFit:{eligibilityBlocked:true,reason:'WOSB set-aside requires current certification validation'},
  vehicleAccessBlocked:true
});
assert.strictEqual(multiple.state,'MULTIPLE_QUALIFICATION_GAPS');
assert.strictEqual(multiple.materialGapCount,3);

console.log('OPPORTUNITY_QUALIFICATION_GAP_SERVICE_TEST=GREEN');
