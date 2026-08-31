'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/SamPublicEmailDiscoveryService');

async function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  const batchLimit=Math.max(1,Math.min(2500,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_LIMIT||2500)));
  const concurrency=Math.max(1,Math.min(12,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_CONCURRENCY||12)));
  const maxBatches=Math.max(1,Math.min(200,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_MAX_BATCHES||200)));
  const maxRuntimeMinutes=Math.max(15,Math.min(1080,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_MAX_RUNTIME_MINUTES||1080)));
  const interBatchDelayMs=Math.max(0,Math.min(30000,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_INTER_BATCH_DELAY_MS||1000)));
  const startedMs=Date.now();
  const startedAt=new Date(startedMs).toISOString();
  let last=null;
  const batches=[];
  let stopReason='MAX_BATCHES_REACHED';

  for(let i=0;i<maxBatches;i++){
    const elapsedMinutes=(Date.now()-startedMs)/60000;
    if(elapsedMinutes>=maxRuntimeMinutes){stopReason='RUNTIME_GUARD_REACHED';break;}

    const result=await new Service({rootDir,limit:batchLimit,concurrency}).run();
    last=result;
    batches.push({
      batch:i+1,
      ok:!!result.ok,
      selected:Number(result.batch?.selected||0),
      processed:Number(result.batch?.processed||0),
      publicEmailsDiscovered:Number(result.batch?.publicEmailsDiscovered||0),
      pagesFetched:Number(result.batch?.pagesFetched||0),
      emailPresent:Number(result.counts?.emailPresent||0),
      unattemptedQualifiedWithWebsite:Number(result.counts?.unattemptedQualifiedWithWebsite||0)
    });

    if(!result.ok){stopReason='BATCH_FAILED';break;}
    if(Number(result.batch?.selected||0)===0){stopReason='NO_MORE_ELIGIBLE_ROWS';break;}
    if(Number(result.counts?.unattemptedQualifiedWithWebsite||0)===0){stopReason='ELIGIBLE_WEBSITE_POOL_EXHAUSTED';break;}

    if(interBatchDelayMs>0)await new Promise(resolve=>setTimeout(resolve,interBatchDelayMs));
  }

  const remaining=Number(last?.counts?.unattemptedQualifiedWithWebsite||0);
  const summary={
    ok:!!last?.ok,
    service:'SAM_PUBLIC_EMAIL_DISCOVERY_CONTINUOUS_MAX_SPEED',
    startedAt,
    finishedAt:new Date().toISOString(),
    mode:{batchLimit,concurrency,maxBatches,maxRuntimeMinutes,interBatchDelayMs},
    stopReason,
    totals:{
      batchesRun:batches.length,
      companiesProcessed:batches.reduce((n,b)=>n+b.processed,0),
      publicEmailsDiscovered:batches.reduce((n,b)=>n+b.publicEmailsDiscovered,0),
      pagesFetched:batches.reduce((n,b)=>n+b.pagesFetched,0)
    },
    latestCounts:last?.counts||null,
    remainingEligibleWebsites:remaining,
    nextStep:remaining>0?'RESUME_CONTINUOUS_DISCOVERY':'MOVE_UNRESOLVED_TO_TWIN_ENRICHMENT_QUEUE_AND_VERIFY_DISCOVERED',
    batches,
    safety:{
      ...(last?.safety||{}),
      selfContinuing:true,
      runtimeGuardMinutes:maxRuntimeMinutes,
      maxBatchesGuard:maxBatches,
      checkpointAfterEveryBatch:true,
      paidVerificationInvoked:false,
      campaignsModified:false,
      currentSendSegmentsModified:false,
      productionOrionModified:false,
      credentialsModified:false,
      oldSamDeleted:false
    }
  };
  console.log(JSON.stringify(summary,null,2));
  process.exitCode=summary.ok?0:2;
}

if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'SAM_PUBLIC_EMAIL_DISCOVERY_CONTINUOUS_MAX_SPEED',error:e.message},null,2));process.exitCode=2;});
