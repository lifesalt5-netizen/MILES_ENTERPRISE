'use strict';

const assert=require('assert');
const Admin=require('../SERVICES/revenue/P2GCFederalGrowthReviewAdminController');

function resCapture(){return{statusCode:null,headers:null,body:'',writeHead(code,headers){this.statusCode=code;this.headers=headers;},end(v){this.body=String(v||'');}};}
function req(method,path,body=null,headers={}){const handlers={};return{method,url:path,headers,socket:{remoteAddress:'127.0.0.1'},connection:{remoteAddress:'127.0.0.1'},on(name,fn){handlers[name]=fn;if(name==='end')setImmediate(()=>{if(body&&handlers.data)handlers.data(Buffer.from(JSON.stringify(body)));fn();});return this;}};}

(async()=>{
  let sends=0;
  const review={reviewId:'R1',status:'READY',release:{approvedByKevin:true,decision:'APPROVE'},presentation:{videoStatus:'READY'},stageState:{PROFESSIONAL_AI_DEMO:{status:'COMPLETE'}}};
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
  const admin=new Admin({builder,release});

  let r=resCapture();await admin.handle(req('GET','/api/admin/review/health'),r,new URL('http://127.0.0.1/api/admin/review/health'));assert.strictEqual(r.statusCode,200);assert.strictEqual(JSON.parse(r.body).loopbackOnly,true);

  const forwarded=req('GET','/api/admin/review/health',null,{'x-forwarded-for':'203.0.113.9'});r=resCapture();await admin.handle(forwarded,r,new URL('http://127.0.0.1/api/admin/review/health'));assert.strictEqual(r.statusCode,403);

  r=resCapture();await admin.handle(req('POST','/api/admin/review/email-preview',{reviewId:'R1',secureLink:'https://example.com/review/R1'}),r,new URL('http://127.0.0.1/api/admin/review/email-preview'));assert.strictEqual(r.statusCode,200);assert.strictEqual(JSON.parse(r.body).sendPerformed,false);assert.strictEqual(sends,0);

  r=resCapture();await admin.handle(req('POST','/api/admin/review/send',{reviewId:'R1'}),r,new URL('http://127.0.0.1/api/admin/review/send'));assert.strictEqual(r.statusCode,403);assert.strictEqual(sends,0);

  r=resCapture();await admin.handle(req('POST','/api/admin/review/send',{reviewId:'R1',authorization:'KEVIN_APPROVED_SEND'}),r,new URL('http://127.0.0.1/api/admin/review/send'));assert.strictEqual(r.statusCode,200);assert.strictEqual(sends,1);

  console.log('P2GC_FEDERAL_GROWTH_REVIEW_ADMIN_GREEN');
})().catch(error=>{console.error(error);process.exit(2);});
