'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/FederalSourceReadinessAuditServiceV2');
const ExecutiveGrowthBlueprintDemoService=require('../SERVICES/demo/ExecutiveGrowthBlueprintDemoService');
const SamQualifiedProspectFallbackService=require('../SERVICES/demo/SamQualifiedProspectFallbackService');
const SamQualifiedProspectNameResolver=require('../SERVICES/demo/SamQualifiedProspectNameResolver');
const HistoricalProspectFallbackService=require('../SERVICES/demo/HistoricalProspectFallbackService');
const DemoTruthReconciliationService=require('../SERVICES/demo/DemoTruthReconciliationService');
const ExecutiveBlueprintCanonicalTruthService=require('../SERVICES/demo/ExecutiveBlueprintCanonicalTruthService');

function elapsed(start){return Date.now()-start;}
function compactModel(model){return {ok:model?.ok===true,status:model?.status||null,company:model?.profile?.companyName||model?.company?.company||null,uei:model?.profile?.uei||model?.company?.uei||null,cage:model?.profile?.cage||null};}
function compactIdentity(result){return {ok:result?.ok===true,status:result?.status||null,legalName:result?.legalName||null,uei:result?.uei||null,cage:result?.cage||null,matchedBy:result?.matchedBy||null,candidateCount:result?.candidateCount??null};}
function compactSource(result){return {ok:result?.ok===true,status:result?.status||null,error:result?.error||null};}
async function timedAsync(fn){const t=Date.now();try{const result=await fn();return {ms:elapsed(t),result};}catch(error){return {ms:elapsed(t),error:String(error?.stack||error?.message||error)};}}
function timedSync(fn){const t=Date.now();try{const result=fn();return {ms:elapsed(t),result};}catch(error){return {ms:elapsed(t),error:String(error?.stack||error?.message||error)};}}

async function diagnoseP2GC(rootDir,term='DeLune Corporation'){
  const baseService=new ExecutiveGrowthBlueprintDemoService();
  const sam=new SamQualifiedProspectFallbackService({rootDir});
  const nameResolver=new SamQualifiedProspectNameResolver({rootDir});
  const historical=new HistoricalProspectFallbackService({rootDir});
  const reconciler=new DemoTruthReconciliationService();
  const canonical=new ExecutiveBlueprintCanonicalTruthService({rootDir,awardTimeoutMs:30000,gsaTimeoutMs:30000});
  try{
    const base=timedSync(()=>baseService.build(term));
    let samFallback=timedSync(()=>sam.build(term));
    const canonicalName=timedSync(()=>nameResolver.resolve(term));
    let samByCanonicalName={ms:0,result:null};
    if(!samFallback.result?.ok&&canonicalName.result?.ok&&canonicalName.result?.uei){
      samByCanonicalName=timedSync(()=>sam.build(canonicalName.result.uei));
      if(samByCanonicalName.result?.ok) samFallback=samByCanonicalName;
    }
    const historicalFallback=timedSync(()=>historical.build(term,{samFallback:samFallback.result||null,canonicalIdentity:canonicalName.result||null,orionFailure:base.result||null}));
    const model=base.result?.ok?base.result:(samFallback.result?.ok?samFallback.result:historicalFallback.result);
    const uei=String(model?.profile?.uei||'').trim();
    let currentSam={ms:0,result:null};
    if(uei) currentSam=timedSync(()=>sam.build(uei));
    const reconciled=model?.ok?reconciler.reconcile(model):model;
    let sources={};
    let hydrate={ms:0,result:null};
    if(reconciled?.ok&&uei){
      const [award,gsa,opportunity,aggregate]=await Promise.all([
        timedAsync(()=>canonical.safeAwardHistory(uei,reconciled.profile?.companyName)),
        timedAsync(()=>canonical.safeGsa(uei,reconciled.profile?.companyName)),
        timedAsync(()=>canonical.safeOpportunities(reconciled)),
        timedAsync(()=>canonical.aggregateEvidence(uei))
      ]);
      sources={
        awardHistory:{ms:award.ms,...compactSource(award.result),error:award.error||award.result?.error||null},
        currentGsa:{ms:gsa.ms,...compactSource(gsa.result),error:gsa.error||null},
        currentPublicOpportunities:{ms:opportunity.ms,...compactSource(opportunity.result),error:opportunity.error||null},
        currentObligationAggregate:{ms:aggregate.ms,...compactSource(aggregate.result),error:aggregate.error||null}
      };
      hydrate=await timedAsync(()=>canonical.hydrate(reconciled,{refresh:true}));
    }
    const stages={
      baseOrion:{ms:base.ms,...compactModel(base.result),error:base.error||null},
      samFallbackByRequestedTerm:{ms:timedSync(()=>sam.build(term)).ms,...compactModel(timedSync(()=>sam.build(term)).result)},
      canonicalNameResolver:{ms:canonicalName.ms,...compactIdentity(canonicalName.result),error:canonicalName.error||null},
      samFallbackByCanonicalUei:{ms:samByCanonicalName.ms,...compactModel(samByCanonicalName.result),error:samByCanonicalName.error||null},
      historicalFallback:{ms:historicalFallback.ms,...compactModel(historicalFallback.result),error:historicalFallback.error||null},
      currentSamByUei:{ms:currentSam.ms,...compactModel(currentSam.result),error:currentSam.error||null},
      canonicalSources:sources,
      canonicalHydrate:{ms:hydrate.ms,...compactModel(hydrate.result),truthStatus:hydrate.result?.truthIntegrity?.status||null,error:hydrate.error||null}
    };
    const flat=[
      ['BASE_ORION',stages.baseOrion.ms],['SAM_FALLBACK_REQUESTED_TERM',stages.samFallbackByRequestedTerm.ms],['CANONICAL_NAME_RESOLVER',stages.canonicalNameResolver.ms],['SAM_FALLBACK_CANONICAL_UEI',stages.samFallbackByCanonicalUei.ms],['HISTORICAL_FALLBACK',stages.historicalFallback.ms],['CURRENT_SAM_BY_UEI',stages.currentSamByUei.ms],
      ...Object.entries(stages.canonicalSources).map(([k,v])=>[k.toUpperCase(),v.ms]),['CANONICAL_HYDRATE',stages.canonicalHydrate.ms]
    ].filter(([,ms])=>Number.isFinite(ms));
    flat.sort((a,b)=>b[1]-a[1]);
    return {ok:true,service:'P2GC_DEMO_LATENCY_DIAGNOSTIC',readOnly:true,term,resolved:compactModel(model),slowestStage:flat[0]?{stage:flat[0][0],ms:flat[0][1]}:null,stages};
  }finally{try{sam.close();}catch{} try{nameResolver.close();}catch{} try{historical.close?.();}catch{}}
}

async function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  const federal=await new Service({rootDir}).run();
  const p2gc=await diagnoseP2GC(rootDir,process.env.P2GC_DIAGNOSTIC_TERM||'DeLune Corporation');
  console.log(JSON.stringify({ok:federal?.ok===true&&p2gc?.ok===true,service:'FEDERAL_SOURCE_READINESS_AUDIT_WITH_P2GC_LATENCY',federalSourceReadiness:federal,p2gcDemoLatency:p2gc},null,2));
  process.exitCode=0;
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'FEDERAL_SOURCE_READINESS_AUDIT_WITH_P2GC_LATENCY',error:e.message,stack:e.stack},null,2));process.exitCode=2;});
module.exports={diagnoseP2GC};
