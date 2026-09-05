'use strict';

const path=require('path');
process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS=process.env.P2GC_LIVE_DEMO_AUDIT_TIMEOUT_MS||'120000';

const Service=require('../SERVICES/orion/FederalSourceReadinessAuditServiceV2');
const LiveAcceptance=require('./AuditLiveP2GCDemoAcceptance');
const StabilityAcceptance=require('./RunP2GCGrowthDemoStabilityAcceptance');

function diagnoseP2GC(rootDir,term='DeLune Corporation'){
  return Promise.resolve({
    ok:true,
    service:'P2GC_DEMO_LATENCY_DIAGNOSTIC',
    status:'DEFERRED_TO_ISOLATED_LIVE_RUNTIME_ACCEPTANCE',
    readOnly:true,
    term,
    rootDir,
    reason:'Avoid loading a second heavyweight federal/SAM/GSA model stack in the acceptance process while simultaneously exercising the production 8791 runtime.'
  });
}

async function runLiveAcceptance(){
  return StabilityAcceptance.runAcceptance();
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

function uiSummary(stability){
  return {
    ok:stability?.ok===true,
    status:stability?.ok===true?'P2GC_UI_SURFACE_AND_FIVE_COMPANY_STABILITY_GREEN':'P2GC_UI_SURFACE_AND_FIVE_COMPANY_STABILITY_RED',
    baseUrl:stability?.baseUrl||LiveAcceptance.BASE_URL,
    initial:stability?.initial||null,
    final:stability?.finalProbe||null,
    companyCount:stability?.companyCount??null,
    passedCompanyCount:stability?.passedCompanyCount??null,
    failedCompanyCount:stability?.failedCompanyCount??null,
    failures:stability?.failures||[]
  };
}

async function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  const term=process.env.P2GC_DIAGNOSTIC_TERM||'DeLune Corporation';
  const federal=await new Service({rootDir}).run();
  const p2gc=await diagnoseP2GC(rootDir,term);
  const live=await runLiveAcceptance();
  const salesPreview=await runSalesPreview(term);
  const ui=uiSummary(live);
  const ok=federal?.ok===true&&p2gc?.ok===true&&live?.ok===true&&salesPreview?.ok===true&&ui?.ok===true;
  console.log(JSON.stringify({
    ok,
    service:'FEDERAL_SOURCE_READINESS_AUDIT_WITH_P2GC_END_TO_END_ACCEPTANCE',
    federalSourceReadiness:federal,
    p2gcDemoLatency:p2gc,
    p2gcLiveAcceptance:live,
    p2gcSalesPreview:salesPreview,
    p2gcUiSurface:ui
  },null,2));
  process.exitCode=ok?0:2;
}

if(require.main===module)main().catch(e=>{
  console.error(JSON.stringify({ok:false,service:'FEDERAL_SOURCE_READINESS_AUDIT_WITH_P2GC_END_TO_END_ACCEPTANCE',error:e.message,stack:e.stack},null,2));
  process.exitCode=2;
});

module.exports={diagnoseP2GC,runLiveAcceptance,runSalesPreview,uiSummary};
