'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const VideoProvider=require('../SERVICES/revenue/P2GCFederalGrowthReviewVideoProviderService');

function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2));}

(function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-video-provider-'));
  const vids=path.join(root,'vids.json');
  const local=path.join(root,'local.json');
  const lifecycle=new Lifecycle({rootDir:root});
  let review=lifecycle.createReview({company:{name:'Example Co'},recipient:{email:'buyer@example.com'},expirationHours:72});
  for(const stage of ['PROSPECT_INTAKE','COMPANY_RESOLUTION','VERIFIED_INTELLIGENCE','ACCURATE_FINDINGS','PERSONALIZED_SCRIPT']){
    lifecycle.completeStage(review.reviewId,stage,{source:'TEST',freshness:new Date().toISOString(),confidence:'HIGH',verificationState:'CONFIRMED'});
  }
  review=lifecycle.read(review.reviewId);
  review.presentation={script:Array.from({length:810},(_,i)=>`word${i+1}`).join(' '),videoStatus:'PENDING',mediaId:null};
  lifecycle.write(review);

  write(vids,{status:'PATHWAYS_GOOGLE_VIDS_ACCESS_PROVEN_AVATAR_NOT_PROVEN',selected:{email:'test@pathwaysgsa.com'},editor:{avatarVisible:false}});
  write(local,{recommendation:{localTalkingAvatarCandidate:false,cpuOnlyCandidate:true,gpuAcceleratedCandidate:false},ffmpeg:{available:false}});
  let svc=new VideoProvider({rootDir:root,lifecycle,vidsAuditFile:vids,localAuditFile:local});
  let selected=svc.selectProvider();
  assert.strictEqual(selected.ok,false);
  assert.strictEqual(selected.provider,null);
  assert(selected.blockers.includes('LOCAL_FFMPEG_REQUIRED'));

  write(vids,{status:'PATHWAYS_GOOGLE_VIDS_AI_AVATAR_PROVEN',selected:{email:'test@pathwaysgsa.com'},editor:{avatarVisible:true}});
  svc=new VideoProvider({rootDir:root,lifecycle,vidsAuditFile:vids,localAuditFile:local});
  selected=svc.selectProvider();
  assert.strictEqual(selected.ok,true);
  assert.strictEqual(selected.provider,'GOOGLE_VIDS');

  const prepared=svc.prepareReview(review.reviewId);
  assert.strictEqual(prepared.ok,true);
  assert.strictEqual(prepared.provider,'GOOGLE_VIDS');
  assert(prepared.segmentPlan.segmentCount>=6);
  assert(prepared.segmentPlan.segments.every(s=>s.estimatedSeconds<=60));
  assert(prepared.segmentPlan.segments.every(s=>s.wordCount<=120));
  review=lifecycle.read(review.reviewId);
  assert.strictEqual(review.presentation.videoStatus,'PROVIDER_READY');

  assert.throws(()=>svc.markVideoReady(review.reviewId,{provider:'GOOGLE_VIDS',durationSeconds:420}),/VIDEO_MEDIA_ID_REQUIRED/);
  assert.throws(()=>svc.markVideoReady(review.reviewId,{provider:'GOOGLE_VIDS',mediaId:'opaque-media',durationSeconds:420}),/VIDEO_RENDERED_AT_REQUIRED/);
  assert.throws(()=>svc.markVideoReady(review.reviewId,{provider:'GOOGLE_VIDS',mediaId:'opaque-media',durationSeconds:420,renderEvidence:{renderedAt:'2026-09-03T21:00:00Z',providerProjectRef:'vid-project',artifactRef:'artifact',completedSegmentCount:1}}),/GOOGLE_VIDS_ALL_SEGMENTS_REQUIRED/);

  const ready=svc.markVideoReady(review.reviewId,{
    provider:'GOOGLE_VIDS',mediaId:'opaque-media',durationSeconds:420,
    renderEvidence:{renderedAt:'2026-09-03T21:00:00Z',providerProjectRef:'vid-project',artifactRef:'artifact-export',completedSegmentCount:prepared.segmentPlan.segmentCount,verifiedBy:'MILES_TEST'}
  });
  assert.strictEqual(ready.ok,true);
  assert.strictEqual(ready.runtimeTargetStatus,'WITHIN_6_TO_10_MINUTE_TARGET');
  review=lifecycle.read(review.reviewId);
  assert.strictEqual(review.stageState.PROFESSIONAL_AI_DEMO.status,'COMPLETE');
  assert.strictEqual(review.presentation.videoStatus,'READY');
  assert.strictEqual(review.presentation.renderEvidence.providerProjectRef,'vid-project');
  assert.strictEqual(review.presentation.renderEvidence.completedSegmentCount,prepared.segmentPlan.segmentCount);

  console.log('P2GC_FEDERAL_GROWTH_REVIEW_VIDEO_PROVIDER_REGRESSION_GREEN');
})();
