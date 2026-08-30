'use strict';
const assert=require('assert');
const Eligibility=require('../SERVICES/orion/SamLeadEligibilityService');
const {parseRecord}=require('../SERVICES/orion/SamQualifiedUniverseBuildService');
const policy=require('../CONFIG/GOVERNMENT_DATA/sam_lead_eligibility_policy.json');
const e=new Eligibility({rootDir:require('path').resolve(__dirname,'..'),policy});
function fields(){const f=Array(142).fill('');f[0]='ABCDEFGHIJKL';f[5]='A';f[6]='Z2';f[8]='20270830';f[9]='20260830';f[11]='GOOD TECH LLC';f[18]='FL';f[21]='USA';f[27]='2L';f[31]='2X~A2';f[32]='541512';f[34]='541512Y~541519Y';f[115]='';f[117]='8W';f[141]='!end';return f;}
let c=parseRecord(fields());let r=e.evaluate(c);assert.equal(r.eligible,true,JSON.stringify(r));
let f=fields();f[31]='2X~2R';c=parseRecord(f);r=e.evaluate(c);assert.equal(r.eligible,false);assert(r.reasons.includes('GOVERNMENT_OR_INSTITUTIONAL_ENTITY'));
f=fields();f[31]='A8';c=parseRecord(f);r=e.evaluate(c);assert.equal(r.eligible,false);assert(r.reasons.includes('NONPROFIT_OR_NONCOMMERCIAL_ENTITY'));
f=fields();f[31]='2X~MF';c=parseRecord(f);r=e.evaluate(c);assert.equal(r.eligible,false);assert(r.reasons.includes('EXCLUDED_INDUSTRY'));
f=fields();f[32]='332710';f[34]='332710Y';c=parseRecord(f);r=e.evaluate(c);assert.equal(r.eligible,false);assert(r.reasons.includes('EXCLUDED_INDUSTRY'));
f=fields();f[31]='LJ';c=parseRecord(f);r=e.evaluate(c);assert.equal(r.status,'REJECTED');assert(r.reasons.includes('NOT_FOR_PROFIT'));
assert.equal(policy.downstreamContactGate.verifiedDeliverableEmailRequiredBeforeCampaign,true);
assert.equal(policy.versionRetention.keepExactlyOneActiveConsolidatedSamUniverse,true);
console.log('SAM_QUALIFIED_UNIVERSE_POLICY_TEST=PASS');
