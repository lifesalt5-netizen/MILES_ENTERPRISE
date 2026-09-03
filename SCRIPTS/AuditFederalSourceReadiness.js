'use strict';
const path=require('path');
process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS=process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS||'60000';
const Service=require('../SERVICES/orion/FederalSourceReadinessAuditServiceV2');
const ExecutiveGrowthBlueprintDemoService=require('../SERVICES/demo/ExecutiveGrowthBlueprintDemoService');
const SamQualifiedProspectFallbackService=require('../SERVICES/demo/SamQualifiedProspectFallbackService');
const SamQualifiedProspectNameResolver=require('../SERVICES/demo/SamQualifiedProspectNameResolver');
const HistoricalRecipientNameIndexService=require('../SERVICES/demo/HistoricalRecipientNameIndexService');
const HistoricalProspectFallbackService=require('../SERVICES/demo/HistoricalProspectFallbackService');
const DemoTruthReconciliationService=require('../SERVICES/demo/DemoTruthReconciliationService');
const ExecutiveBlueprintCanonicalTruthService=require('../SERVICES/demo/ExecutiveBlueprintCanonicalTruthService');
const LiveAcceptance=require('./AuditLiveP2GCDemoAcceptance');
const UiAcceptance=require('./AuditP2GCDemoUiSurface');

function elapsed(start){return Date.now()-start;}
function compactModel(model){return {ok:model?.ok===true,status:model?.status||null,company:model?.profile?.companyName||model?.company?.company||null,uei:model?.profile?.uei||model?.company?.uei||null,cage:model?.profile?.cage||null};}
function compactIdentity(result){return {ok:result?.ok===true,status:result?.status||null,legalName:result?.legalName||null,uei:result?.uei||null,cage:result?.cage||null,matchedBy:result?.matchedBy||null,candidateCount:result?.candidateCount??null,indexStatus:result?.indexStatus||null};}
function compactSamIdentity(result){return {ok:result?.ok===true,status:result?.status||null,legalBusinessName:result?.legalBusinessName||null,uei:result?.uei||null,cageCode:result?.cageCode||null,registrationStatus:result?.registrationStatus||null,samRegistered:result?.samRegistered??null,registrationExpirationDate:result?.registrationExpirationDate||null,source:result?.source||null,error:result?.error||null};}
function compactSource(result){return {ok:result?.ok===true,status:result?.status||null,error:result?.error||null};}
async function timedAsync(fn){const t=Date.now();try{const result=await fn();return {ms:elapsed(t),result};}catch(error){return {ms:elapsed(t),error:String(error?.stack||error?.message||error)};}}
function timedSync(fn){const t=Date.now();try{const result=fn();return {ms:elapsed(t),result};}catch(error){return {ms:elapsed(t),error:String(error?.stack||error?.message||error)};}}

async function diagnoseP2GC(rootDir,term='DeLune Corporation'){
  const baseService=new ExecutiveGrowthBlueprintDemoService();
  const sam=new SamQualifiedProspectFallbackService({rootDir});
  const nameResolver=new SamQualifiedProspectNameResolver({rootDir});
  const historicalIndex=new HistoricalRecipientNameIndexService({rootDir});
  const historical=new HistoricalProspectFallbackService({rootDir});
  const reconciler=new DemoTruthReconciliationService();
  const canonical=new ExecutiveBlueprintCanonicalTruthService({rootDir,awardTimeoutMs:30000,gsaTimeoutMs:30000});
  try{
    const base=timedSync(()=>baseService.build(term));
    const samRequested=timedSync(()=>sam.build(term));
    let samFallback=samRequested;
    const canonicalName=timedSync(()=>nameResolver.resolve(term));
    let samByCanonicalName={ms:0,result:null};
    if(!samFallback.result?.ok&&canonicalName.result?.ok&&canonicalName.result?.uei){
      samByCanonicalName=timedSync(()=>sam.build(canonicalName.result.uei));
      if(samByCanonicalName.result?.ok) samFallback=samByCanonicalName;
    }
    const historicalIdentity=timedSync(()=>historicalIndex.resolve(term));
    let historicalIndexedModel={ms:0,result:null};
    if(!samFallback.result?.ok&&historicalIdentity.result?.ok&&historicalIdentity.result?.row){
      historicalIndexedModel=timedSync(()=>historical.historicalModel(term,{ok:true,row:historicalIdentity.result.row,matchedBy:historicalIdentity.result.matchedBy},historical.sourceStatus()));
    }
    let historicalWildcard={ms:0,result:null};
    if(!samFallback.result?.ok&&!historicalIndexedModel.result?.ok){
      historicalWildcard=timedSync(()=>historical.build(term,{samFallback:samFallback.result||null,canonicalIdentity:canonicalName.result||null,historicalIdentity:historicalIdentity.result||null,orionFailure:base.result||null}));
    }
    const model=base.result?.ok?base.result:(samFallback.result?.ok?samFallback.result:(historicalIndexedModel.result?.ok?historicalIndexedModel.result:historicalWildcard.result));
    const uei=String(model?.profile?.uei||'').trim();
    let currentSam={ms:0,result:null};
    if(uei) currentSam=timedSync(()=>sam.build(uei));
    let targetedSam={ms:0,result:null};
    if(uei) targetedSam=await timedAsync(()=>canonical.awardHistory.resolveSamIdentity(uei));
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
      samFallbackByRequestedTerm:{ms:samRequested.ms,...compactModel(samRequested.result),error:samRequested.error||null},
      canonicalSamNameResolver:{ms:canonicalName.ms,...compactIdentity(canonicalName.result),error:canonicalName.error||null},
      samFallbackByCanonicalUei:{ms:samByCanonicalName.ms,...compactModel(samByCanonicalName.result),error:samByCanonicalName.error||null},
      historicalNameIndex:{ms:historicalIdentity.ms,...compactIdentity(historicalIdentity.result),error:historicalIdentity.error||null},
      historicalIndexedModel:{ms:historicalIndexedModel.ms,...compactModel(historicalIndexedModel.result),error:historicalIndexedModel.error||null},
      historicalWildcardFallback:{ms:historicalWildcard.ms,...compactModel(historicalWildcard.result),error:historicalWildcard.error||null},
      currentSamByUei:{ms:currentSam.ms,...compactModel(currentSam.result),error:currentSam.error||null},
      targetedSamEntityByUei:{ms:targetedSam.ms,...compactSamIdentity(targetedSam.result),error:targetedSam.error||targetedSam.result?.error||null},
      canonicalSources:sources,
      canonicalHydrate:{ms:hydrate.ms,...compactModel(hydrate.result),truthStatus:hydrate.result?.truthIntegrity?.status||null,error:hydrate.error||null}
    };
    const flat=[
      ['BASE_ORION',stages.baseOrion.ms],['SAM_FALLBACK_REQUESTED_TERM',stages.samFallbackByRequestedTerm.ms],['CANONICAL_SAM_NAME_RESOLVER',stages.canonicalSamNameResolver.ms],['SAM_FALLBACK_CANONICAL_UEI',stages.samFallbackByCanonicalUei.ms],['HISTORICAL_NAME_INDEX',stages.historicalNameIndex.ms],['HISTORICAL_INDEXED_MODEL',stages.historicalIndexedModel.ms],['HISTORICAL_WILDCARD_FALLBACK',stages.historicalWildcardFallback.ms],['CURRENT_SAM_BY_UEI',stages.currentSamByUei.ms],['TARGETED_SAM_ENTITY_BY_UEI',stages.targetedSamEntityByUei.ms],
      ...Object.entries(stages.canonicalSources).map(([k,v])=>[k.toUpperCase(),v.ms]),['CANONICAL_HYDRATE',stages.canonicalHydrate.ms]
    ].filter(([,ms])=>Number.isFinite(ms));
    flat.sort((a,b)=>b[1]-a[1]);
    return {ok:true,service:'P2GC_DEMO_LATENCY_DIAGNOSTIC',readOnly:true,term,resolved:compactModel(model),slowestStage:flat[0]?{stage:flat[0][0],ms:flat[0][1]}:null,stages};
  }finally{try{sam.close();}catch{} try{nameResolver.close();}catch{} try{historical.close?.();}catch{}}
}

async function runLiveAcceptance(term){
  const runtime=await LiveAcceptance.ensureDemoCurrent();
  const result=runtime?.ok===true?await LiveAcceptance.auditCompany(term):{requestedTerm:term,ok:false,failures:[`DEMO_RUNTIME_NOT_CURRENT:${runtime?.status||runtime?.reason||'UNKNOWN'}`]};
  return {ok:runtime?.ok===true&&result?.ok===true,status:runtime?.ok===true&&result?.ok===true?'LIVE_DELUNE_ACCEPTANCE_GREEN':'LIVE_DELUNE_ACCEPTANCE_RED',runtime,result};
}

async function runSalesPreview(term){
  const response=await LiveAcceptance.requestJson(`/api/assessment?term=${encodeURIComponent(term)}`);
  if(!response?.ok||!response?.body?.ok)return {ok:false,status:'SALES_PREVIEW_ASSESSMENT_UNAVAILABLE',error:response?.error||response?.raw||null};
  const m=response.body;
  const p=m.commercialPreview||{};
  return {
    ok:true,
    status:'SALES_PREVIEW_PROOF_TOTALS_AVAILABLE',
    company:m.profile?.companyName||null,
    uei:m.profile?.uei||null,
    cage:m.profile?.cage||null,
    samStatus:m.profile?.samStatus||null,
    gsaStatus:m.profile?.gsaStatus||null,
    readinessOverall:m.readiness?.overall??null,
    truthStatus:m.truthIntegrity?.status||null,
    proofTotals:p.totals||null,
    visibility:{
      opportunities:{shown:p.opportunities?.visibleCount??null,locked:p.opportunities?.lockedCount??null},
      primePartners:{shown:p.primePartners?.visibleCount??null,locked:p.primePartners?.lockedCount??null},
      recompetes:{shown:p.recompetes?.visibleCount??null,locked:p.recompetes?.lockedCount??null},
      buyers:{shown:p.buyers?.visibleCount??null,locked:p.buyers?.lockedCount??null},
      competitors:{shown:p.competitors?.visibleCount??null,locked:p.competitors?.lockedCount??null},
      vehicles:{shown:p.vehicles?.visibleCount??null,locked:p.vehicles?.lockedCount??null}
    },
    topPrimeCandidates:(m.primePartners?.records||[]).slice(0,3).map(x=>({company:x.company,uei:x.uei,fitScore:x.fitScore??null,confidence:x.confidence||null,basis:x.basis||null})),
    topOpportunities:(m.opportunities?.liveAndForecast||[]).slice(0,3).map(x=>({title:x.title,agency:x.agency,estimatedValue:x.estimatedValue??null,setAside:x.setAside||null,fitScore:x.fitScore??null,directPursuitEligible:x.directPursuitEligible??null,eligibilityBlocker:x.eligibilityBlocker||null}))
  };
}

async function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  const term=process.env.P2GC_DIAGNOSTIC_TERM||'DeLune Corporation';
  const federal=await new Service({rootDir}).run();
  const p2gc=await diagnoseP2GC(rootDir,term);
  const live=await runLiveAcceptance(term);
  const salesPreview=await runSalesPreview(term);
  const ui=await UiAcceptance.auditUiSurface();
  const ok=federal?.ok===true&&p2gc?.ok===true&&live?.ok===true&&salesPreview?.ok===true&&ui?.ok===true;
  console.log(JSON.stringify({ok,service:'FEDERAL_SOURCE_READINESS_AUDIT_WITH_P2GC_END_TO_END_ACCEPTANCE',federalSourceReadiness:federal,p2gcDemoLatency:p2gc,p2gcLiveAcceptance:live,p2gcSalesPreview:salesPreview,p2gcUiSurface:ui},null,2));
  process.exitCode=ok?0:2;
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'FEDERAL_SOURCE_READINESS_AUDIT_WITH_P2GC_END_TO_END_ACCEPTANCE',error:e.message,stack:e.stack},null,2));process.exitCode=2;});
module.exports={diagnoseP2GC,runLiveAcceptance,runSalesPreview};
