'use strict';
const assert=require('assert');
// Loading reconciliation installs the shared evidence-first canonical hydrate policy.
require('../SERVICES/demo/DemoTruthReconciliationService');
const Canonical=require('../SERVICES/demo/ExecutiveBlueprintCanonicalTruthService');

let sawEvidence=false;
const award={
  ok:true,
  status:'AUTHORITATIVE_AWARD_HISTORY_READ',
  dataQuality:{zeroAwardClassificationPermitted:true,warnings:[]},
  summary:{awardCount:1,primeAwardCount:1,subcontractAwardCount:0,primeAwardedRevenue:1000,subcontractedRevenue:0},
  primeAwards:[{awardId:'A1',amount:1000,startDate:'2026-01-01',endDate:'2026-12-31',description:'Software and information technology support services',awardingAgency:'TEST AGENCY'}],
  subcontracts:[],
  source:{name:'USAspending.gov'},
  governingDefinition:{}
};
const gsa={
  ok:true,status:'CURRENT_GSA_MAS_HOLDER_CONFIRMED',holder:true,
  records:[{contractNumber:'47TEST',categories:['54151S'],legalBusinessName:'Example LLC',uei:'TESTUEI12345'}],
  source:{authority:'GSA eLibrary',fresh:true},limitations:[]
};
const opportunityService={
  async match(model){
    sawEvidence=Boolean(model?.awardHistory?.primeAwards?.some(x=>/software/i.test(x.description||'')) && model?.profile?.gsaContracts?.some(x=>(x.categories||[]).includes('54151S')));
    return {ok:true,status:'CURRENT_PUBLIC_OPPORTUNITY_CANDIDATES_AVAILABLE',source:{fresh:true},qualification:{discovered:1,directFitSupported:sawEvidence?1:0},records:[{title:'Software Support',agency:'TEST',naics:'541511',dueDate:'2026-10-01',fitScore:sawEvidence?80:40,qualificationTier:sawEvidence?'DIRECT_FIT_SUPPORTED':'CAPABILITY_VALIDATION_REQUIRED'}]};
  }
};
const svc=new Canonical({
  rootDir:process.cwd(),
  awardHistoryService:{auditByUei:async()=>award},
  gsaTruthService:{lookup:async()=>gsa},
  opportunityService
});
svc.aggregateEvidence=async()=>({ok:false,status:'TEST_NO_AGGREGATE',source:{fresh:false}});

(async()=>{
  const model={ok:true,profile:{companyName:'Example LLC',uei:'TESTUEI12345',naicsCodes:['541511'],contractVehicles:[]},currentState:{},vehicles:{current:[],recommendations:[]},recommendations:{immediate:[],vehicle:[],agency:[],partner:[],opportunity:[],growth:[]},opportunities:{liveAndForecast:[],recompetes:[]},gaps:{items:[]},revenue:{current:{},opportunity:{}},truthIntegrity:{conflicts:[],warnings:[],rules:[]}};
  const out=await svc.hydrate(model);
  assert.strictEqual(sawEvidence,true,'opportunity matcher must see canonical award/GSA evidence before qualification');
  assert.strictEqual(out.opportunities.qualification.directFitSupported,1);
  assert.strictEqual(out.evidence.canonicalTruth.hydrationOrder,'AUTHORITATIVE_COMPANY_EVIDENCE_THEN_OPPORTUNITY_QUALIFICATION');
  console.log('EVIDENCE_FIRST_OPPORTUNITY_QUALIFICATION_TEST=GREEN');
})().catch(err=>{console.error(err);process.exit(1);});
