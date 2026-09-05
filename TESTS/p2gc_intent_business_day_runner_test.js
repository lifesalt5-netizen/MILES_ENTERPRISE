'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const P2GCIntentBusinessDayRunner=require('../SERVICES/revenue/P2GCIntentBusinessDayRunner');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-intent-business-day-'));
try{
  const calls=[];
  const pipeline={ingestBatch:(signals,options)=>{calls.push({signals,options});return {ok:true,observed:signals.length,qualified:signals.length,rejected:0,workbookUpdated:options.executeWorkbookWrite?signals.length:0,workbookPlanned:options.executeWorkbookWrite?0:signals.length};}};
  const monday=new Date('2026-09-07T14:00:00Z');
  const runner=new P2GCIntentBusinessDayRunner({rootDir:root,pipeline,now:()=>monday,timeZone:'America/New_York'});
  const signals=[{company:'Acme Federal LLC',sourceUrl:'https://example.com/signal'}];
  const first=runner.run({signals,executeWorkbookWrite:true});
  assert.strictEqual(first.ok,true);
  assert.strictEqual(first.status,'INTENT_BUSINESS_DAY_RUN_GREEN');
  assert.strictEqual(first.executed,true);
  assert.strictEqual(first.qualified,1);
  assert.strictEqual(first.workbookUpdated,1);
  assert.strictEqual(first.safety.outboundSendPerformed,false);
  assert.strictEqual(first.safety.providerMutationPerformed,false);
  assert.strictEqual(calls.length,1);
  assert.strictEqual(calls[0].options.executeWorkbookWrite,true);

  const second=runner.run({signals,executeWorkbookWrite:true});
  assert.strictEqual(second.status,'INTENT_BUSINESS_DAY_ALREADY_COMPLETE');
  assert.strictEqual(second.executed,false);
  assert.strictEqual(calls.length,1);

  const saturday=new P2GCIntentBusinessDayRunner({rootDir:path.join(root,'weekend'),pipeline,now:()=>new Date('2026-09-05T14:00:00Z'),timeZone:'America/New_York'});
  const skipped=saturday.run({signals});
  assert.strictEqual(skipped.status,'INTENT_BUSINESS_DAY_SKIPPED_WEEKEND');
  assert.strictEqual(skipped.executed,false);
  assert.strictEqual(calls.length,1);

  const forced=saturday.run({signals,force:true});
  assert.strictEqual(forced.status,'INTENT_BUSINESS_DAY_RUN_GREEN');
  assert.strictEqual(forced.executed,true);
  assert.strictEqual(calls.length,2);

  assert(fs.existsSync(path.join(root,'DATA','runtime','revenue','intent_leads','latest_business_day_run.json')));
  assert(fs.existsSync(path.join(root,'DATA','runtime','revenue','intent_leads','business_day_runner_state.json')));
  console.log('P2GC_INTENT_BUSINESS_DAY_RUNNER_GREEN');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
