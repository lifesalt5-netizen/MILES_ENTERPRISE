'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Scheduler=require('../SERVICES/revenue/P2GCIntentProductionScheduler');

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-intent-prod-scheduler-'));
  try{
    let ingestionCalls=0,runnerCalls=0;
    const ingestion={run:async()=>{ingestionCalls++;return {ok:true,status:'INTENT_LIVE_SOURCE_INGESTION_GREEN',qualified:2};}};
    const runner={run:opts=>{runnerCalls++;return {ok:true,status:'INTENT_BUSINESS_DAY_RUN_GREEN',qualified:2,workbookUpdated:false,options:opts};}};
    const weekday=new Date('2026-09-08T14:00:00Z');
    const svc=new Scheduler({rootDir:root,ingestion,runner,now:()=>weekday,startHour:8,endHour:17});
    assert.strictEqual(svc.inOperatingWindow(weekday),true);
    const r=await svc.tick();
    assert.strictEqual(r.ok,true);
    assert.strictEqual(r.status,'INTENT_PRODUCTION_SCHEDULER_GREEN');
    assert.strictEqual(ingestionCalls,1);
    assert.strictEqual(runnerCalls,1);
    assert.strictEqual(r.safety.outboundSendPerformed,false);
    assert.strictEqual(r.safety.providerMutationPerformed,false);

    const weekend=new Date('2026-09-05T14:00:00Z');
    const weekendSvc=new Scheduler({rootDir:root,ingestion,runner,now:()=>weekend});
    const w=await weekendSvc.tick();
    assert.strictEqual(w.status,'INTENT_PRODUCTION_SCHEDULER_OUTSIDE_WINDOW');
    assert.strictEqual(ingestionCalls,1);
    assert.strictEqual(runnerCalls,1);

    const blockedSvc=new Scheduler({rootDir:root,ingestion:{run:async()=>({ok:false,status:'BLOCKED'})},runner,now:()=>weekday});
    const b=await blockedSvc.tick();
    assert.strictEqual(b.ok,false);
    assert.strictEqual(b.status,'INTENT_PRODUCTION_SCHEDULER_INGESTION_BLOCKED');
    assert.strictEqual(runnerCalls,1);

    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','CONFIG','p2gc_intent_live_sources.json'),'utf8'));
    assert.ok(Array.isArray(manifest.sources));
    assert.ok(manifest.sources.length>=4);
    for(const source of manifest.sources){
      assert.strictEqual(source.enabled,true);
      assert.ok(/^https:\/\//.test(source.url));
      assert.strictEqual(source.platform,'PUBLIC_JOB_POSTING');
      assert.ok(source.fieldMap.company);
      assert.ok(source.fieldMap.sourceUrl);
      assert.ok(source.fieldMap.originalPostDate);
      assert.ok(source.fieldMap.needSummary);
      assert.ok(source.fieldMap.excerpt);
    }
    console.log('P2GC_INTENT_PRODUCTION_SCHEDULER_TEST_PASS');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(err=>{console.error(err);process.exit(1);});
