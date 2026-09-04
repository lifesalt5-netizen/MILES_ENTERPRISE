'use strict';

const assert=require('assert');
const Admin=require('../SERVICES/revenue/P2GCFederalGrowthReviewAdminController');
const {publicReview}=require('../SERVICES/revenue/P2GCFederalGrowthReviewHttpController');

function resCapture(){return{statusCode:null,headers:null,body:'',writeHead(code,headers){this.statusCode=code;this.headers=headers;},end(v){this.body=String(v||'');}};}
function req(method,path,body=null,headers={}){const handlers={};return{method,url:path,headers,socket:{remoteAddress:'127.0.0.1'},connection:{remoteAddress:'127.0.0.1'},on(name,fn){handlers[name]=fn;if(name==='end')setImmediate(()=>{if(body&&handlers.data)handlers.data(Buffer.from(JSON.stringify(body)));fn();});return this;}};}

(async()=>{
  let sends=0;let capturedVideoReady=null;
  const review={reviewId:'R1',status:'READY',recipient:{name:'Buyer',email:'buyer@example.com'},company:{name:'Example Co'},release:{approvedByKevin:true,decision:'APPROVE'},presentation:{videoStatus:'READY',streamingReady:true,mediaId:'secret-media-id',renderEvidence:{providerProjectRef:'secret-provider-ref'}},stageState:{PROFESSIONAL_AI_DEMO:{status:'COMPLETE'}},scoring:{fitScore:92,intentScore:77,salesPriority:85},engagementSummary:{maxPlaybackPct:75,questionCount:2,meetingBooked:false},findings:[],priorityOptions:[]};
  const lifecycle={read:id=>id==='R1'?review:null,getGreenGate:()=>({green:false}),write:r=>r};
  const release={
    lifecycle,
    applyDecision:(id,d)=>({...review,status:d==='APPROVE'?'APPROVED':d,release:{...review.release,decision:d,approvedByKevin:d==='APPROVE'}}),
    createSecureLink:()=>({ok:true,status:'P2GC_SECURE_REVIEW_LINK_READY',reviewId:'R1',secureLinkId:'L1',link:'https://example.com/review/R1?access=x'}),
    emailDraft:()=>({from:'kevin@pathways2gc.com',to:'buyer@example.com',subject:'Review',text:'Preview'}),
    recordManualSend:()=>({...review,release:{...review.release,sentAt:'2026-09-03T00:00:00Z'}}),
    sendApprovedReview:async()=>{sends++;return{ok:true,status:'SENT'};}
  };
  const builder={createFromAssessment:async()=>({ok:true,status:'DRAFT',reviewId:'R1'})};
  const videoProvider={
    selectProvider:()=>({ok:true,provider:'GOOGLE_VIDS'}),
    prepareReview:()=>({ok:true,provider:'GOOGLE_VIDS'}),
    markVideoReady:(id,input)=>{capturedVideoReady={id,input};return{ok:true,status:'PROFESSIONAL_AI_DEMO_READY',reviewId:id,streamingReady:true};}
  };
  const admin=new Admin({builder,release,videoProvider});

  const prospectView=publicReview(review);
  assert.strictEqual(prospectView.scoring,undefined,'internal sales scoring must not be exposed to prospect');
  assert.strictEqual(prospectView.engagement,undefined,'internal behavioral engagement metrics must not be exposed to prospect');
  assert.strictEqual(prospectView.video.mediaId,undefined,'private media identifier must not be exposed to prospect');
  assert.strictEqual(prospectView.video.playable,true);

  let r=resCapture();await admin.handle(req('GET','/api/admin/review/health'),r,new URL('http://127.0.0.1/api/admin/review/health'));assert.strictEqual(r.statusCode,200);assert.strictEqual(JSON.parse(r.body).loopbackOnly,true);

  const forwarded=req('GET','/api/admin/review/health',null,{'x-forwarded-for':'203.0.113.9'});r=resCapture();await admin.handle(forwarded,r,new URL('http://127.0.0.1/api/admin/review/health'));assert.strictEqual(r.statusCode,403);

  const renderEvidence={renderedAt:'2026-09-03T21:00:00Z',providerProjectRef:'vid-project',artifactRef:'artifact-export',completedSegmentCount:7,verifiedBy:'MILES_TEST'};
  r=resCapture();await admin.handle(req('POST','/api/admin/review/video-ready',{reviewId:'R1',provider:'GOOGLE_VIDS',mediaId:'media-r1',durationSeconds:420,localArtifactPath:'C:\\secure\\review.mp4',renderEvidence}),r,new URL('http://127.0.0.1/api/admin/review/video-ready'));
  assert.strictEqual(r.statusCode,200);
  assert.strictEqual(capturedVideoReady.id,'R1');
  assert.strictEqual(capturedVideoReady.input.localArtifactPath,'C:\\secure\\review.mp4');
  assert.deepStrictEqual(capturedVideoReady.input.renderEvidence,renderEvidence);

  r=resCapture();await admin.handle(req('POST','/api/admin/review/email-preview',{reviewId:'R1',secureLink:'https://example.com/review/R1'}),r,new URL('http://127.0.0.1/api/admin/review/email-preview'));assert.strictEqual(r.statusCode,200);assert.strictEqual(JSON.parse(r.body).sendPerformed,false);assert.strictEqual(sends,0);

  r=resCapture();await admin.handle(req('POST','/api/admin/review/send',{reviewId:'R1'}),r,new URL('http://127.0.0.1/api/admin/review/send'));assert.strictEqual(r.statusCode,403);assert.strictEqual(sends,0);

  r=resCapture();await admin.handle(req('POST','/api/admin/review/send',{reviewId:'R1',authorization:'KEVIN_APPROVED_SEND'}),r,new URL('http://127.0.0.1/api/admin/review/send'));assert.strictEqual(r.statusCode,200);assert.strictEqual(sends,1);

  console.log('P2GC_FEDERAL_GROWTH_REVIEW_ADMIN_GREEN');
})().catch(error=>{console.error(error);process.exit(2);});
