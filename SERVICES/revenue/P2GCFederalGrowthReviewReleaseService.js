'use strict';

const crypto=require('crypto');
const Lifecycle=require('./P2GCFederalGrowthReviewLifecycleService');
const Access=require('./P2GCFederalGrowthReviewAccessService');

function clean(v){return String(v==null?'':v).trim();}
function baseUrl(v){return clean(v).replace(/\/$/,'');}

class P2GCFederalGrowthReviewReleaseService {
  constructor(options={}){
    this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();
    this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});
    this.access=options.access||new Access(options.accessOptions||{});
    this.sender=options.sender||null;
    this.publicBaseUrl=baseUrl(options.publicBaseUrl||process.env.P2GC_PUBLIC_REVIEW_BASE_URL||'');
  }

  getSender(){
    if(this.sender)return this.sender;
    this.sender=require('../../CONNECTORS/IONOS/smtp_governed');
    return this.sender;
  }

  requireReview(reviewId){const r=this.lifecycle.read(reviewId);if(!r)throw new Error('REVIEW_NOT_FOUND');return r;}
  requirePreReleaseStages(record){
    const required=['PROSPECT_INTAKE','COMPANY_RESOLUTION','VERIFIED_INTELLIGENCE','ACCURATE_FINDINGS','PERSONALIZED_SCRIPT','PROFESSIONAL_AI_DEMO'];
    const missing=required.filter(stage=>record.stageState?.[stage]?.status!=='COMPLETE');
    if(missing.length)throw new Error(`PRE_RELEASE_STAGES_INCOMPLETE:${missing.join(',')}`);
  }
  requirePresentationComplete(record){
    this.requirePreReleaseStages(record);
    if(record.presentation?.videoStatus!=='READY')throw new Error('PROFESSIONAL_AI_VIDEO_NOT_READY');
    if(!clean(record.presentation?.mediaId))throw new Error('PROFESSIONAL_AI_MEDIA_ID_REQUIRED');
    if(record.presentation?.streamingReady!==true)throw new Error('PROFESSIONAL_AI_PRIVATE_STREAM_NOT_READY');
  }
  applyDecision(reviewId,decision,notes=''){
    const action=clean(decision).toUpperCase();
    const allowed=new Set(['APPROVE','EDIT','REJECT','NURTURE','PAUSE']);
    if(!allowed.has(action))throw new Error('UNSUPPORTED_KEVIN_REVIEW_DECISION');
    let record=this.requireReview(reviewId);
    if(action==='APPROVE'){
      this.requirePresentationComplete(record);
      record=this.lifecycle.approveRelease(reviewId,'KEVIN');
      record.release.decision='APPROVE';record.release.decisionNotes=clean(notes)||null;record.release.decisionAt=new Date().toISOString();return this.lifecycle.write(record);
    }
    record.release.decision=action;record.release.decisionNotes=clean(notes)||null;record.release.decisionAt=new Date().toISOString();record.release.approvedByKevin=false;record.release.approvedAt=null;
    record.status=action==='REJECT'?'REJECTED':action==='NURTURE'?'NURTURE':action==='PAUSE'?'PAUSED':'EDIT_REQUIRED';record.green=false;
    return this.lifecycle.write(record);
  }

  createSecureLink(reviewId,options={}){
    const record=this.requireReview(reviewId);
    if(!record.release?.approvedByKevin)throw new Error('KEVIN_APPROVAL_REQUIRED_BEFORE_SECURE_LINK');
    this.requirePresentationComplete(record);
    if(!this.publicBaseUrl||!/^https:\/\//i.test(this.publicBaseUrl))throw new Error('PUBLIC_REVIEW_HTTPS_BASE_URL_REQUIRED');
    const token=this.access.createAccessToken(record,{ttlSeconds:Number(options.ttlSeconds||record.expirationHours*3600)});
    const secureLinkId=crypto.randomUUID();
    const link=`${this.publicBaseUrl}/review/${encodeURIComponent(record.reviewId)}?access=${encodeURIComponent(token)}`;
    record.release.secureLinkId=secureLinkId;record.release.secureLinkCreatedAt=new Date().toISOString();record.release.publicReviewBaseUrl=this.publicBaseUrl;
    this.lifecycle.write(record);
    return {ok:true,status:'P2GC_SECURE_REVIEW_LINK_READY',reviewId:record.reviewId,secureLinkId,link,expiresAt:record.expiresAt};
  }

  emailDraft(reviewId,secureLink){
    const record=this.requireReview(reviewId);
    if(!record.release?.approvedByKevin)throw new Error('KEVIN_APPROVAL_REQUIRED_BEFORE_EMAIL_DRAFT');
    this.requirePresentationComplete(record);
    const runtime=record.presentation?.runtime?.display||`Estimated runtime: ${record.presentation?.runtime?.estimatedMinutes||'6–10'} minutes`;
    const first=clean(record.recipient?.name).split(/\s+/)[0]||'there';
    const subject=`Your Personalized Federal Growth Review — ${record.company?.name}`;
    const text=[
      `Hi ${first},`,'',
      `I had P2GC prepare a Personalized Federal Growth Review for ${record.company?.name}.`,
      `It is based on the company-specific federal position and verified findings we have available now.`,'',
      `${runtime}.`,'',
      'Your secure review:',secureLink,'',
      `Access expires: ${new Date(record.expiresAt).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'})}.`,
      'The review is private and tied to the authorized recipient. You will verify your email before it opens.','',
      'At the end, you can send me a question and schedule a focused 15–20 minute review of the findings.','',
      'Kevin Chace','Pathways 2 Government Contracting'
    ].join('\n');
    return {from:'kevin@pathways2gc.com',replyTo:'kevin@pathways2gc.com',to:record.recipient.email,subject,text,runtime,expiresAt:record.expiresAt};
  }

  async sendApprovedReview(reviewId,options={}){
    let record=this.requireReview(reviewId);
    if(!record.release?.approvedByKevin)throw new Error('KEVIN_APPROVAL_REQUIRED_BEFORE_SEND');
    if(record.release?.sentAt)throw new Error('REVIEW_ALREADY_SENT');
    this.requirePresentationComplete(record);
    const linkResult=options.secureLink?{link:options.secureLink,secureLinkId:options.secureLinkId||crypto.randomUUID()}:this.createSecureLink(reviewId,options);
    const draft=this.emailDraft(reviewId,linkResult.link);
    const sent=await this.getSender().sendEmail(draft);
    if(sent?.ok!==true)throw new Error(`IONOS_REVIEW_SEND_FAILED:${sent?.status||'UNKNOWN'}`);
    record=this.lifecycle.markSent(reviewId,{sentFrom:'kevin@pathways2gc.com',secureLinkId:linkResult.secureLinkId});
    record.release.smtpAcceptedAt=sent.sentAt||new Date().toISOString();record.release.smtpMessageId=sent.messageId||null;record.release.deliveryVerificationState='SMTP_ACCEPTED_NOT_DELIVERY_CONFIRMED';
    this.lifecycle.write(record);
    this.lifecycle.recordEngagement(reviewId,'SEND',{recipientEmail:record.recipient.email,metadata:{provider:'IONOS_SMTP',messageId:sent.messageId||null}});
    return {ok:true,status:'P2GC_PERSONALIZED_REVIEW_SENT_FROM_KEVIN',reviewId,to:record.recipient.email,from:'kevin@pathways2gc.com',secureLinkId:linkResult.secureLinkId,smtpAccepted:true,deliveryConfirmed:false,messageId:sent.messageId||null};
  }

  recordManualSend(reviewId,secureLinkId){
    const record=this.requireReview(reviewId);
    if(!record.release?.approvedByKevin)throw new Error('KEVIN_APPROVAL_REQUIRED_BEFORE_SEND');
    this.requirePresentationComplete(record);
    const sent=this.lifecycle.markSent(reviewId,{sentFrom:'kevin@pathways2gc.com',secureLinkId});
    sent.release.manualSendRecorded=true;sent.release.deliveryVerificationState='MANUAL_SEND_RECORDED_DELIVERY_NOT_CONFIRMED';
    return this.lifecycle.write(sent);
  }
}

module.exports=P2GCFederalGrowthReviewReleaseService;
