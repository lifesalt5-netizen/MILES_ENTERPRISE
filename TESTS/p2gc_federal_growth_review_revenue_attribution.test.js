'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const Attribution=require('../SERVICES/revenue/P2GCFederalGrowthReviewRevenueAttributionService');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-attribution-'));
try{
  const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'..','CONFIG','P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json'),'utf8'));
  const lifecycle=new Lifecycle({rootDir:root,contract,stateDir:path.join(root,'reviews')});
  const svc=new Attribution({rootDir:root,lifecycle,outDir:path.join(root,'attrib')});
  const r=lifecycle.createReview({reviewId:'P2GC-ATTRIB-TEST',company:{name:'TEST CO'},recipient:{name:'Pat',email:'pat@example.com',companyDomain:'example.com'}});
  assert.throws(()=>svc.attribute(r.reviewId,{amount:2500,currency:'USD',paymentRef:'PAY-001',sourceType:'PERSONALIZED_REVIEW',sourceId:r.reviewId}),/MATCHING_RECORDED_PAYMENT_REQUIRED/);
  lifecycle.recordEngagement(r.reviewId,'PAYMENT',{recipientEmail:'pat@example.com',value:2500,metadata:{paymentRef:'PAY-001',currency:'USD'}});
  assert.throws(()=>svc.attribute(r.reviewId,{amount:2500,currency:'USD',paymentRef:'PAY-001'}),/ATTRIBUTION_SOURCE_TYPE_AND_ID_REQUIRED/);
  assert.throws(()=>svc.attribute(r.reviewId,{amount:2500,currency:'USD',paymentRef:'PAY-001',sourceType:'CAMPAIGN',sourceId:'campaign-source'}),/CAMPAIGN_ID_REQUIRED/);
  const out=svc.attribute(r.reviewId,{amount:2500,currency:'USD',paymentRef:'PAY-001',sourceType:'PERSONALIZED_REVIEW',sourceId:r.reviewId,sourceLabel:'Personalized Federal Growth Review'});
  assert.equal(out.ok,true);
  assert.equal(out.artifact.revenue.amount,2500);
  assert.equal(out.artifact.source.type,'PERSONALIZED_REVIEW');
  assert.equal(out.artifact.source.id,r.reviewId);
  assert.equal(out.artifact.evidence.paymentEventMatched,true);
  assert.equal(out.artifact.evidence.fabricatedSource,false);
  const final=lifecycle.read(r.reviewId);
  assert.equal(final.stageState.REVENUE_ATTRIBUTION.status,'COMPLETE');
  assert.ok(final.engagement.some(e=>e.type==='REVENUE_ATTRIBUTION'));
  console.log('P2GC_FEDERAL_GROWTH_REVIEW_REVENUE_ATTRIBUTION_GREEN');
}finally{fs.rmSync(root,{recursive:true,force:true});}
