'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/SamPublicEmailDiscoveryService');

async function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  const batchLimit=Math.max(1,Math.min(2500,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_LIMIT||2500)));
  const concurrency=Math.max(1,Math.min(12,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_CONCURRENCY||12)));
  const maxBatches=Math.max(1,Math.min(20,Number(process.env.SAM_PUBLIC_EMAIL_DISCOVERY_MAX_BATCHES||4)));
  const startedAt=new Date().toISOString();
  let last=null;
  const batches=[];

  for(let i=0;i<maxBatches;i++){
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
    if(!result.ok||Number(result.batch?.selected||0)===0||Number(result.counts?.unattemptedQualifiedWithWebsite||0)===0)break;
  }

  const summary={
    ok:!!last?.ok,
    service:'SAM_PUBLIC_EMAIL_DISCOVERY_MAX_SPEED',
    startedAt,
    finishedAt:new Date().toISOString(),
    mode:{batchLimit,concurrency,maxBatches},
    totals:{
      batchesRun:batches.length,
      companiesProcessed:batches.reduce((n,b)=>n+b.processed,0),
      publicEmailsDiscovered:batches.reduce((n,b)=>n+b.publicEmailsDiscovered,0),
      pagesFetched:batches.reduce((n,b)=>n+b.pagesFetched,0)
    },
    latestCounts:last?.counts||null,
    nextStep:last?.nextStep||null,
    batches,
    safety:last?.safety||null
  };
  console.log(JSON.stringify(summary,null,2));
  process.exitCode=summary.ok?0:2;
}

if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'SAM_PUBLIC_EMAIL_DISCOVERY_MAX_SPEED',error:e.message},null,2));process.exitCode=2;});
