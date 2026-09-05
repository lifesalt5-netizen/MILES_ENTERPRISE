'use strict';

const P2GCIntentProductionScheduler=require('../SERVICES/revenue/P2GCIntentProductionScheduler');

function bool(v){ return ['1','true','yes','y','on'].includes(String(v??'').trim().toLowerCase()); }

(async()=>{
  const scheduler=new P2GCIntentProductionScheduler();
  const executeWorkbookWrite=bool(process.env.P2GC_INTENT_WARM_PIPELINE_WRITE_ENABLED);
  const result=await scheduler.tick({force:true,executeWorkbookWrite});
  const acceptance={
    ok:result.ok===true,
    status:result.status,
    forcedAcceptance:true,
    productionWeekdayGuardUnchanged:true,
    workbookWriteRequested:executeWorkbookWrite,
    outboundSendPerformed:result?.safety?.outboundSendPerformed===true,
    providerMutationPerformed:result?.safety?.providerMutationPerformed===true,
    result
  };
  process.stdout.write(`${JSON.stringify(acceptance,null,2)}\n`);
  if(!acceptance.ok || acceptance.outboundSendPerformed || acceptance.providerMutationPerformed) process.exitCode=2;
})().catch(error=>{
  process.stderr.write(`${error?.stack||error}\n`);
  process.exitCode=2;
});
