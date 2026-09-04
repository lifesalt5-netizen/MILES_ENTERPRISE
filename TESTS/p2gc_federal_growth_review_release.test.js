'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const Access=require('../SERVICES/revenue/P2GCFederalGrowthReviewAccessService');
const Release=require('../SERVICES/revenue/P2GCFederalGrowthReviewReleaseService');

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-release-'));
  const contract=require('../CONFIG/P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json');
  const lifecycle=new Lifecycle({rootDir:path.resolve(__dirname,'..'),stateDir:path.join(temp,'reviews'),contract});
  const review=lifecycle.createReview({company:{name:'Example LLC',domain:'example.com'},recipient:{email:'buyer@example.com',name:'Buyer Example',companyDomain:'example.com'},expirationHours:72});
  const access=new Access({secret:'1234567890abcdefghijklmnopqrstuvwxyz-RELEASE-TEST'});
  const sent=[];
  const sender={sendEmail:async payload=>{sent.push(payload);return {ok:true,status:'IONOS_SMTP_ACCEPTED',messageId:'msg-1',sentAt:'2026-09-03T20:40:00Z'};}};
  const release=new Release({lifecycle,access,sender,publicBaseUrl:'https://reviews.pathways2gc.com'});

  assert.throws(()=>release.applyDecision(review.reviewId,'APPROVE'),/PRE_RELEASE_STAGES_INCOMPLETE/);
  for(const stage of ['PROSPECT_INTAKE','COMPANY_RESOLUTION','VERIFIED_INTELLIGENCE','ACCURATE_FINDINGS','PERSONALIZED_SCRIPT']){
    lifecycle.completeStage(review.reviewId,stage,{source:'TEST',freshness:'2026-09-03T20:38:00Z',confidence:'HIGH',verificationState:'CONFIRMED'});
  }
  let r=lifecycle.read(review.reviewId);
  r.presentation={videoStatus:'READY',mediaId:'media-123',streamingReady:false,runtime:{estimatedMinutes:7.8,display:'Actual runtime: 7 minutes 48 seconds'}};
  lifecycle.write(r);
  lifecycle.completeStage(review.reviewId,'PROFESSIONAL_AI_DEMO',{source:'AI_VIDEO_PROVIDER',freshness:'2026-09-03T20:39:00Z',confidence:'HIGH',verificationState:'CONFIRMED'});
  assert.throws(()=>release.applyDecision(review.reviewId,'APPROVE'),/PROFESSIONAL_AI_PRIVATE_STREAM_NOT_READY/);

  r=lifecycle.read(review.reviewId);r.presentation.streamingReady=true;lifecycle.write(r);
  r=release.applyDecision(review.reviewId,'APPROVE','Approved for release');
  assert.strictEqual(r.release.approvedByKevin,true);
  assert.strictEqual(r.stageState.KEVIN_APPROVAL.status,'COMPLETE');

  const link=release.createSecureLink(review.reviewId);
  assert.strictEqual(link.ok,true);
  assert(link.link.startsWith('https://reviews.pathways2gc.com/review/'));
  assert(link.link.includes('access='));

  const draft=release.emailDraft(review.reviewId,link.link);
  assert.strictEqual(draft.from,'kevin@pathways2gc.com');
  assert.strictEqual(draft.to,'buyer@example.com');
  assert(draft.text.includes('Actual runtime: 7 minutes 48 seconds'));
  assert(draft.text.includes(link.link));

  r=lifecycle.read(review.reviewId);r.presentation.streamingReady=false;lifecycle.write(r);
  await assert.rejects(()=>release.sendApprovedReview(review.reviewId,{secureLink:link.link,secureLinkId:link.secureLinkId}),/PROFESSIONAL_AI_PRIVATE_STREAM_NOT_READY/);
  r=lifecycle.read(review.reviewId);r.presentation.streamingReady=true;lifecycle.write(r);

  const result=await release.sendApprovedReview(review.reviewId,{secureLink:link.link,secureLinkId:link.secureLinkId});
  assert.strictEqual(result.ok,true);
  assert.strictEqual(result.from,'kevin@pathways2gc.com');
  assert.strictEqual(result.smtpAccepted,true);
  assert.strictEqual(result.deliveryConfirmed,false);
  assert.strictEqual(sent.length,1);
  r=lifecycle.read(review.reviewId);
  assert.strictEqual(r.stageState.SECURE_SEND_FROM_KEVIN.status,'COMPLETE');
  assert.strictEqual(r.release.deliveryVerificationState,'SMTP_ACCEPTED_NOT_DELIVERY_CONFIRMED');
  await assert.rejects(()=>release.sendApprovedReview(review.reviewId,{secureLink:link.link,secureLinkId:link.secureLinkId}),/REVIEW_ALREADY_SENT/);

  const paused=lifecycle.createReview({company:{name:'Pause LLC'},recipient:{email:'p@pause.com',companyDomain:'pause.com'}});
  const p=release.applyDecision(paused.reviewId,'PAUSE','Wait for updated evidence');
  assert.strictEqual(p.status,'PAUSED');
  assert.strictEqual(p.release.approvedByKevin,false);
  console.log('P2GC_FEDERAL_GROWTH_REVIEW_RELEASE_GREEN');
})().catch(error=>{console.error(error);process.exit(2);});
