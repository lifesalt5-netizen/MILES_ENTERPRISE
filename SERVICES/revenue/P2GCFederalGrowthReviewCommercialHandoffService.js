'use strict';

const fs=require('fs');
const path=require('path');
const Lifecycle=require('./P2GCFederalGrowthReviewLifecycleService');
function clean(v){return String(v==null?'':v).trim();}
function isoNow(){return new Date().toISOString();}
function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function httpsUrl(v){const s=clean(v);return/^https:\/\//i.test(s)?s:null;}

class P2GCFederalGrowthReviewCommercialHandoffService{
  constructor(options={}){this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});this.outDir=options.outDir||path.join(this.rootDir,'DATA','federal_growth_review_commercial_handoffs');}
  buildDraft(reviewId,input={}){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    const lifecycleApprovedByKevin=record.release?.approvedByKevin===true&&Boolean(record.release?.approvedAt);
    const draft={version:1,reviewId,createdAt:isoNow(),company:record.company?.name||null,recipient:record.recipient?.email||null,packageName:clean(input.packageName)||null,scopeSummary:clean(input.scopeSummary)||null,price:money(input.price),currency:clean(input.currency||'USD').toUpperCase(),proposalRef:clean(input.proposalRef)||null,paymentUrl:httpsUrl(input.paymentUrl),approvedByKevin:lifecycleApprovedByKevin,approvalNote:clean(input.approvalNote)||record.release?.decisionNotes||null,approvalEvidence:lifecycleApprovedByKevin?{source:'REVIEW_LIFECYCLE',approvedAt:record.release.approvedAt,decision:record.release?.decision||'APPROVE'}:null,proposalStatus:clean(input.proposalStatus||'DRAFT').toUpperCase(),paymentStatus:'NOT_PAID',guards:{pricingInvented:false,automaticCharge:false,finalOfferRequiresKevin:true,callerSuppliedApprovalIgnored:true,httpsPaymentRequired:true}};
    draft.readyToHandoff=Boolean(draft.approvedByKevin&&draft.packageName&&draft.scopeSummary&&draft.price&&draft.currency&&draft.proposalRef&&draft.paymentUrl);
    fs.mkdirSync(this.outDir,{recursive:true});const file=path.join(this.outDir,`${reviewId}.json`);fs.writeFileSync(file,JSON.stringify(draft,null,2),'utf8');
    if(!draft.readyToHandoff)return{ok:true,status:'COMMERCIAL_HANDOFF_DRAFT_ONLY',reviewId,file,draft,blockers:[!draft.approvedByKevin?'KEVIN_APPROVAL_REQUIRED':null,!draft.packageName?'PACKAGE_NAME_REQUIRED':null,!draft.scopeSummary?'SCOPE_SUMMARY_REQUIRED':null,!draft.price?'PRICE_REQUIRED':null,!draft.proposalRef?'PROPOSAL_REFERENCE_REQUIRED':null,!draft.paymentUrl?'HTTPS_PAYMENT_HANDOFF_REQUIRED':null].filter(Boolean)};
    this.lifecycle.recordEngagement(reviewId,'PROPOSAL_CREATED',{recipientEmail:record.recipient?.email,metadata:{proposalRef:draft.proposalRef,packageName:draft.packageName}});
    this.lifecycle.completeStage(reviewId,'PACKAGE_PROPOSAL_PAYMENT_HANDOFF',{source:'P2GC_COMMERCIAL_HANDOFF',freshness:draft.createdAt,confidence:'HIGH',verificationState:'CONFIRMED',artifact:file,notes:`Lifecycle-approved Kevin package ${draft.packageName}; proposal ${draft.proposalRef}; payment handoff configured`});
    return{ok:true,status:'PACKAGE_PROPOSAL_PAYMENT_HANDOFF_READY',reviewId,file,draft};
  }
  markProposalSent(reviewId,input={}){const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');const proposalRef=clean(input.proposalRef);if(!proposalRef)throw new Error('PROPOSAL_REFERENCE_REQUIRED');this.lifecycle.recordEngagement(reviewId,'PROPOSAL_SENT',{recipientEmail:record.recipient?.email,metadata:{proposalRef}});return{ok:true,status:'PROPOSAL_SENT_RECORDED',reviewId,proposalRef};}
  markPayment(reviewId,input={}){const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');const amount=money(input.amount);const paymentRef=clean(input.paymentRef);if(!amount||!paymentRef)throw new Error('PAYMENT_AMOUNT_AND_REFERENCE_REQUIRED');const currency=clean(input.currency||'USD').toUpperCase();this.lifecycle.recordEngagement(reviewId,'PAYMENT',{recipientEmail:record.recipient?.email,value:amount,metadata:{paymentRef,currency}});return{ok:true,status:'PAYMENT_RECORDED',reviewId,amount,currency,paymentRef};}
}
module.exports=P2GCFederalGrowthReviewCommercialHandoffService;
