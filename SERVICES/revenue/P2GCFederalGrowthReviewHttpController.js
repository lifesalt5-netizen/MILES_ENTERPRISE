'use strict';

const path = require('path');
const crypto = require('crypto');
const Lifecycle = require('./P2GCFederalGrowthReviewLifecycleService');
const Access = require('./P2GCFederalGrowthReviewAccessService');
const Verification = require('./P2GCFederalGrowthReviewVerificationService');

function clean(v){ return String(v == null ? '' : v).trim(); }
function parseCookies(header=''){
  const out={};
  for(const part of String(header||'').split(';')){
    const i=part.indexOf('='); if(i<0) continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function safeJson(res,status,body,headers={}){
  res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',...headers });
  res.end(JSON.stringify(body,null,2));
}
function readBody(req,limit=256*1024){
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',chunk=>{ raw+=chunk; if(Buffer.byteLength(raw)>limit) reject(new Error('REQUEST_TOO_LARGE')); });
    req.on('end',()=>{ if(!raw.trim()) return resolve({}); try{resolve(JSON.parse(raw));}catch{reject(new Error('INVALID_JSON'));} });
    req.on('error',reject);
  });
}
function publicReview(record){
  return {
    reviewId:record.reviewId,
    company:{ name:record.company?.name||null },
    recipient:{ name:record.recipient?.name||null, email:record.recipient?.email||null },
    expiresAt:record.expiresAt,
    status:record.status,
    findings:(record.findings||[])
      .filter(f=>f.freePreviewVisibility!=='LOCKED')
      .map(f=>({ id:f.id,section:f.section,title:f.title,finding:f.finding,whatItMeans:f.whatItMeans,whyItMatters:f.whyItMatters,businessImpact:f.businessImpact,howP2GCAddressesIt:f.howP2GCAddressesIt })),
    lockedFindingCount:(record.findings||[]).filter(f=>f.freePreviewVisibility==='LOCKED').length,
    priorityOptions:record.priorityOptions||[],
    scoring:{ fitScore:record.scoring?.fitScore??0,intentScore:record.scoring?.intentScore??0,salesPriority:record.scoring?.salesPriority??0 },
    engagement:{ maxPlaybackPct:record.engagementSummary?.maxPlaybackPct||0,questionCount:record.engagementSummary?.questionCount||0,meetingBooked:record.engagementSummary?.meetingBooked===true },
    runtime:record.presentation?.runtime||null,
    video:{ status:record.presentation?.videoStatus||'PENDING',mediaId:record.presentation?.mediaId||null },
    writtenReviewFallback:true,
    cta:{ label:'Review Your Findings With Kevin',meetingMinutes:'15–20' }
  };
}

class P2GCFederalGrowthReviewHttpController {
  constructor(options={}){
    this.rootDir=options.rootDir||path.resolve(__dirname,'..','..');
    this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});
    this.access=options.access||new Access(options.accessOptions||{});
    this.verification=options.verification||new Verification(options.verificationOptions||{});
    this.publicDir=options.publicDir||path.join(this.rootDir,'SERVICES','review','public');
    this.cookieName='p2gc_review_session';
  }

  securityHeaders(){ return this.access.publicSecurityHeaders(); }

  readReview(reviewId){
    try{return this.lifecycle.read(reviewId);}catch{return null;}
  }

  sessionContext(req,reviewId){
    const token=parseCookies(req.headers.cookie||'')[this.cookieName];
    if(!token) return {ok:false,reason:'SESSION_REQUIRED'};
    const verified=this.access.verifyToken(token,{kind:'REVIEW_SESSION',reviewId});
    if(!verified.ok) return verified;
    const record=this.readReview(reviewId);
    if(!record) return {ok:false,reason:'REVIEW_NOT_FOUND'};
    if(record.security?.revokedAt) return {ok:false,reason:'REVIEW_REVOKED'};
    if(Date.now()>=Date.parse(record.expiresAt||0)) return {ok:false,reason:'REVIEW_EXPIRED'};
    return {ok:true,record,payload:verified.payload,authenticatedEmail:verified.payload.recipientEmail,sessionId:verified.payload.sessionId};
  }

  createSessionCookie(record,email,session){
    const now=Math.floor(Date.now()/1000);
    const sessionExp=Math.floor(Date.parse(session.expiresAt)/1000);
    const reviewExp=Math.floor(Date.parse(record.expiresAt)/1000);
    const exp=Math.min(sessionExp,reviewExp);
    const token=this.access.signPayload({iss:this.access.issuer,kind:'REVIEW_SESSION',reviewId:record.reviewId,recipientEmail:email,sessionId:session.sessionId,iat:now,nbf:now-5,exp,jti:crypto.randomUUID()});
    const maxAge=Math.max(60,exp-now);
    return `${this.cookieName}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  }

  async handle(req,res,url){
    const pathname=url.pathname;
    const pageMatch=pathname.match(/^\/review\/([A-Za-z0-9._-]+)$/);
    if(req.method==='GET' && pageMatch){
      const file=path.join(this.publicDir,'review.html');
      const fs=require('fs');
      if(!fs.existsSync(file)){ res.writeHead(503,this.securityHeaders()); res.end('Review application unavailable'); return true; }
      res.writeHead(200,{...this.securityHeaders(),'Content-Type':'text/html; charset=utf-8'});
      res.end(fs.readFileSync(file)); return true;
    }
    if(req.method==='GET' && pathname==='/review/review.js'){
      const fs=require('fs'); const file=path.join(this.publicDir,'review.js');
      if(!fs.existsSync(file)){res.writeHead(404);res.end('Not found');return true;}
      res.writeHead(200,{...this.securityHeaders(),'Content-Type':'application/javascript; charset=utf-8'});res.end(fs.readFileSync(file));return true;
    }
    if(req.method==='GET' && pathname==='/review/review.css'){
      const fs=require('fs'); const file=path.join(this.publicDir,'review.css');
      if(!fs.existsSync(file)){res.writeHead(404);res.end('Not found');return true;}
      res.writeHead(200,{...this.securityHeaders(),'Content-Type':'text/css; charset=utf-8'});res.end(fs.readFileSync(file));return true;
    }

    const api=pathname.match(/^\/api\/review\/([A-Za-z0-9._-]+)\/(request-code|verify|state|video-token|event|question|close-session)$/);
    if(!api) return false;
    const reviewId=api[1]; const action=api[2];
    const record=this.readReview(reviewId);
    if(!record){safeJson(res,404,{ok:false,status:'REVIEW_NOT_FOUND'},this.securityHeaders());return true;}

    try{
      if(req.method==='POST' && action==='request-code'){
        const body=await readBody(req);
        const tokenCheck=this.access.verifyToken(body.accessToken,{kind:'REVIEW_ACCESS',reviewId});
        if(!tokenCheck.ok){safeJson(res,403,{ok:false,status:tokenCheck.reason},this.securityHeaders());return true;}
        const authorization=this.lifecycle.authorizeAccess(reviewId,{email:body.email});
        if(!authorization.ok){safeJson(res,403,{ok:false,status:authorization.reason},this.securityHeaders());return true;}
        const result=await this.verification.requestCode(record,body.email);
        safeJson(res,result.ok?200:403,result,this.securityHeaders());return true;
      }

      if(req.method==='POST' && action==='verify'){
        const body=await readBody(req);
        const accessCheck=this.access.validateRecipientAccess(body.accessToken,record,body.email);
        if(!accessCheck.ok){safeJson(res,403,{ok:false,status:accessCheck.reason},this.securityHeaders());return true;}
        const verified=this.verification.verifyCode(record,body.email,body.code);
        if(!verified.ok){safeJson(res,403,{ok:false,status:verified.reason,attemptsRemaining:verified.attemptsRemaining},this.securityHeaders());return true;}
        const opened=this.access.openSession(record,verified.authenticatedEmail,{ip:req.socket?.remoteAddress,userAgent:req.headers['user-agent']});
        if(!opened.ok){safeJson(res,429,{ok:false,status:opened.reason},this.securityHeaders());return true;}
        const cookie=this.createSessionCookie(record,verified.authenticatedEmail,opened.session);
        this.lifecycle.recordEngagement(reviewId,'AUTHENTICATED_REVIEW_ACCESS',{recipientEmail:verified.authenticatedEmail,sessionId:opened.session.sessionId});
        this.lifecycle.completeStage(reviewId,'AUTHORIZED_ACCESS',{source:'RECIPIENT_EMAIL_VERIFICATION',freshness:new Date().toISOString(),confidence:'HIGH',verificationState:'CONFIRMED'});
        const refreshed=this.lifecycle.read(reviewId);
        safeJson(res,200,{ok:true,status:'REVIEW_ACCESS_AUTHENTICATED',review:publicReview(refreshed),watermark:this.access.watermarkContext(refreshed,verified.authenticatedEmail)}, {...this.securityHeaders(),'Set-Cookie':cookie});return true;
      }

      const session=this.sessionContext(req,reviewId);
      if(!session.ok){safeJson(res,401,{ok:false,status:session.reason},this.securityHeaders());return true;}

      if(req.method==='GET' && action==='state'){
        safeJson(res,200,{ok:true,review:publicReview(session.record),watermark:this.access.watermarkContext(session.record,session.authenticatedEmail)},this.securityHeaders());return true;
      }
      if(req.method==='POST' && action==='video-token'){
        const body=await readBody(req); const mediaId=clean(body.mediaId||session.record.presentation?.mediaId);
        if(!mediaId){safeJson(res,409,{ok:false,status:'VIDEO_NOT_READY',writtenReviewFallback:true},this.securityHeaders());return true;}
        const token=this.access.createVideoToken(session.record,session.authenticatedEmail,session.sessionId,mediaId);
        safeJson(res,200,{ok:true,status:'SIGNED_VIDEO_TOKEN_ISSUED',token,expiresInSeconds:this.access.videoTokenTtlSeconds,mediaId},this.securityHeaders());return true;
      }
      if(req.method==='POST' && action==='event'){
        const body=await readBody(req);
        const updated=this.lifecycle.recordEngagement(reviewId,clean(body.type),{recipientEmail:session.authenticatedEmail,sessionId:session.sessionId,value:body.value,metadata:body.metadata||null});
        safeJson(res,200,{ok:true,status:'ENGAGEMENT_RECORDED',intentScore:updated.scoring.intentScore,salesPriority:updated.scoring.salesPriority},this.securityHeaders());return true;
      }
      if(req.method==='POST' && action==='question'){
        const body=await readBody(req); const question=clean(body.question).slice(0,2000);
        if(!question){safeJson(res,400,{ok:false,status:'QUESTION_REQUIRED'},this.securityHeaders());return true;}
        const updated=this.lifecycle.recordEngagement(reviewId,'QUESTION_SUBMITTED',{recipientEmail:session.authenticatedEmail,sessionId:session.sessionId,metadata:{question,priorityOptionId:clean(body.priorityOptionId)||null}});
        safeJson(res,200,{ok:true,status:'QUESTION_RECORDED',intentScore:updated.scoring.intentScore,salesPriority:updated.scoring.salesPriority},this.securityHeaders());return true;
      }
      if(req.method==='POST' && action==='close-session'){
        this.access.closeSession(reviewId,session.authenticatedEmail,session.sessionId);
        safeJson(res,200,{ok:true,status:'SESSION_CLOSED'}, {...this.securityHeaders(),'Set-Cookie':`${this.cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`});return true;
      }
      safeJson(res,405,{ok:false,status:'METHOD_NOT_ALLOWED'},this.securityHeaders());return true;
    }catch(error){
      safeJson(res,error.message==='REQUEST_TOO_LARGE'?413:500,{ok:false,status:'REVIEW_REQUEST_FAILED',error:error.message},this.securityHeaders());return true;
    }
  }
}

module.exports=P2GCFederalGrowthReviewHttpController;
module.exports.publicReview=publicReview;
