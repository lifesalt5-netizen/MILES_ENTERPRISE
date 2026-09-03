'use strict';
const assert=require('assert');
const Gap=require('../SERVICES/demo/OpportunityQualificationGapService');

const maintenance=Gap.analyze({
  title:'Preventive Maintenance and Repair Services - Generator and Electrical Systems',
  capability:{directFit:false,scopeClass:'SPECIALIZED_MAINTENANCE'},
  setAsideFit:{eligibilityBlocked:false}
});
assert.strictEqual(maintenance.nearFit,true);
assert.strictEqual(maintenance.materialGapCount,1);
assert.strictEqual(maintenance.state,'NEAR_FIT_SINGLE_CAPABILITY_GAP');
assert.strictEqual(maintenance.singleGap.type,'CAPABILITY');
assert(maintenance.singleGap.requirement.length>0);
assert(maintenance.closureOptions.some(x=>/subcontractor|teaming partner/i.test(x)));
assert(maintenance.closureOptions.some(x=>/company already has/i.test(x)));

const direct=Gap.analyze({
  title:'Software Application Support',
  capability:{directFit:true,scopeClass:'IT_TECHNOLOGY'},
  setAsideFit:{eligibilityBlocked:false}
});
assert.strictEqual(direct.materialGapCount,0);
assert.strictEqual(direct.state,'PRELIMINARY_DIRECT_FIT_SUPPORTED');

const teaming=Gap.analyze({
  title:'Cybersecurity Support',
  capability:{directFit:true,scopeClass:'IT_TECHNOLOGY'},
  setAsideFit:{eligibilityBlocked:true,reason:'SDVOSB set-aside requires current certification validation'}
});
assert.strictEqual(teaming.nearFit,true);
assert.strictEqual(teaming.singleGap.type,'SET_ASIDE_ELIGIBILITY');
assert(teaming.closureOptions.some(x=>/team/i.test(x)));

console.log('OPPORTUNITY_NEAR_FIT_GAP_INTEGRATION_TEST=GREEN');
