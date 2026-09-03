'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const CloseBrief=require('../SERVICES/revenue/P2GCFederalGrowthReviewCloseBriefService');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-close-brief-'));
try{
  const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'..','CONFIG','P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json'),'utf8'));
  const lifecycle=new Lifecycle({rootDir:root,contract,stateDir:path.join(root,'reviews')});
  const svc=new CloseBrief({rootDir:root,lifecycle,outDir:path.join(root,'briefs')});
  const review=lifecycle.createReview({reviewId:'P2GC-CLOSE-BRIEF-TEST',company:{name:'TEST FEDERAL LLC',uei:'TESTUEI',cage:'TESTCAGE'},recipient:{name:'Pat Buyer',email:'pat@example.com',companyDomain:'example.com'}});
  assert.throws(()=>svc.generate(review.reviewId),/ACCURATE_FINDINGS_REQUIRED/);
  lifecycle.addFinding(review.reviewId,{id:'f1',title:'Vehicle activation gap',finding:'A verified federal vehicle is present but current performance evidence is limited.',whatItMeans:'The vehicle exists but performance should not be assumed.',whyItMatters:'Positioning should use verified performance only.',businessImpact:'Unverified performance claims could misdirect pursuit.',howP2GCAddressesIt:'P2GC validates vehicle performance before recommending actions.',source:'CANONICAL_REVIEW',freshness:'2026-09-03T22:00:00Z',confidence:'HIGH',verificationState:'CONFIRMED',material:true});
  lifecycle.completeStage(review.reviewId,'ACCURATE_FINDINGS',{source:'TEST',freshness:'2026-09-03T22:00:00Z',confidence:'HIGH',verificationState:'CONFIRMED'});
  lifecycle.updateFitScore(review.reviewId,82,['VERIFIED_FIT']);
  lifecycle.recordEngagement(review.reviewId,'AUTHENTICATED_REVIEW_ACCESS',{recipientEmail:'pat@example.com',sessionId:'s1'});
  lifecycle.recordEngagement(review.reviewId,'VIDEO_75',{recipientEmail:'pat@example.com',sessionId:'s1',value:75});
  lifecycle.recordEngagement(review.reviewId,'QUESTION_SUBMITTED',{recipientEmail:'pat@example.com',sessionId:'s1',metadata:{question:'Which gap should we address first?',priorityOptionId:'f1'}});
  const out=svc.generate(review.reviewId);
  assert.equal(out.ok,true);
  assert.equal(out.brief.company.name,'TEST FEDERAL LLC');
  assert.equal(out.brief.prospectQuestions[0].question,'Which gap should we address first?');
  assert.equal(out.brief.prospectPrioritySignals[0],'Vehicle activation gap');
  assert.equal(out.brief.engagement.maxPlaybackPct,75);
  assert.equal(out.brief.commercialGuardrails.pricingIncluded,false);
  assert.equal(out.brief.commercialGuardrails.finalOfferRequiresKevin,true);
  assert.equal(out.brief.sourceIntegrity.noFabricatedFacts,true);
  assert.equal(lifecycle.read(review.reviewId).stageState.KEVIN_CLOSE_BRIEF.status,'COMPLETE');
  console.log('P2GC_FEDERAL_GROWTH_REVIEW_CLOSE_BRIEF_GREEN');
}finally{fs.rmSync(root,{recursive:true,force:true});}
