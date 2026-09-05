'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const launcher=fs.readFileSync(path.join(root,'FINAL_GO_LIVE.cmd'),'utf8');
const acceptance=fs.readFileSync(path.join(root,'SCRIPTS','RunP2GCIntentProductionAcceptance.js'),'utf8');

assert.match(launcher,/pm2 describe p2gc-intent-production-scheduler/i);
assert.match(launcher,/pm2 start SERVICES\\revenue\\P2GCIntentProductionScheduler\.js --name p2gc-intent-production-scheduler/i);
assert.match(launcher,/pm2 restart[^\r\n]*p2gc-intent-production-scheduler[^\r\n]*--update-env/i);
assert.match(acceptance,/tick\(\{force:true,executeWorkbookWrite\}\)/);
assert.match(acceptance,/P2GC_INTENT_WARM_PIPELINE_WRITE_ENABLED/);
assert.match(acceptance,/productionWeekdayGuardUnchanged:true/);
assert.match(acceptance,/outboundSendPerformed/);
assert.match(acceptance,/providerMutationPerformed/);

console.log('P2GC_INTENT_RUNTIME_REGISTRATION_TEST_PASS 8/8');
