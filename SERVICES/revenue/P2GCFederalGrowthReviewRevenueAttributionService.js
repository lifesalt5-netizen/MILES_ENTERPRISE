'use strict';

const fs=require('fs');
const path=require('path');
const Lifecycle=require('./P2GCFederalGrowthReviewLifecycleService');

function clean(v){return String(v==null?'':v).trim();}
function positive(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function now(){return new Date().toISOString();}

class P2GCFederalGrowthReviewRevenueAttributionService{
  constructor(options={}){this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});this.outDir=options.outDir||path.join(this.rootDir,'DATA','federal_growth_review_revenue_attribution');}
  paymentEvents(record){return(record.engagement||[]).filter(e=>e.type==='PAYMENT');}
  findPayment(record,input={}){
    const ref=clean(input.paymentRef);const amount=positive(input.amount);const currency=clean(input.currency||'USD').toUpperCase();
    return this.paymentEvents(record).find(e=>{
      const eRef=clean(e.metadata?.paymentRef);const eAmount=positive(e.value);const eCurrency=clean(e.metadata?.currency||'USD').toUpperCase();
      return ref&&eRef===ref&&amount===eAmount&&currency===eCurrency;
    })||null;
  }
  attribute(reviewId,input={}){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    const amount=positive(input.amount);const currency=clean(input.currency||'USD').toUpperCase();const paymentRef=clean(input.paymentRef);
    if(!amount||!paymentRef)throw new Error('PAYMENT_AMOUNT_AND_REFERENCE_REQUIRED');
    const payment=this.findPayment(record,{amount,currency,paymentRef});if(!payment)throw new Error('MATCHING_RECORDED_PAYMENT_REQUIRED');
    const sourceType=clean(input.sourceType).toUpperCase();const sourceId=clean(input.sourceId);
    if(!sourceType||!sourceId)throw new Error('ATTRIBUTION_SOURCE_TYPE_AND_ID_REQUIRED');
    const allowed=new Set(['PERSONALIZED_REVIEW','CAMPAIGN','CONTENT_ASSET','DIRECT_OUTREACH','REFERRAL','OTHER_VERIFIED_SOURCE']);
    if(!allowed.has(sourceType))throw new Error('ATTRIBUTION_SOURCE_TYPE_UNSUPPORTED');
    const campaignId=clean(input.campaignId)||null;const contentAssetId=clean(input.contentAssetId)||null;
    if(sourceType==='CAMPAIGN'&&!campaignId)throw new Error('CAMPAIGN_ID_REQUIRED_FOR_CAMPAIGN_ATTRIBUTION');
    if(sourceType==='CONTENT_ASSET'&&!contentAssetId)throw new Error('CONTENT_ASSET_ID_REQUIRED_FOR_CONTENT_ATTRIBUTION');
    const artifact={
      version:1,reviewId,attributedAt:now(),company:record.company?.name||null,recipient:record.recipient?.email||null,
      revenue:{amount,currency,paymentRef,paymentRecordedAt:payment.at||null},
      source:{type:sourceType,id:sourceId,campaignId,contentAssetId,sourceLabel:clean(input.sourceLabel)||null},
      linkage:{reviewId:record.reviewId,secureLinkId:record.release?.secureLinkId||null,sentAt:record.release?.sentAt||null,meetingBooked:record.engagementSummary?.meetingBooked===true,proposalCreated:record.engagementSummary?.proposalCreated===true},
      evidence:{paymentEventMatched:true,sourceProvidedByVerifiedInput:true,inferredCampaign:false,inferredContentAsset:false,fabricatedSource:false}
    };
    fs.mkdirSync(this.outDir,{recursive:true});const file=path.join(this.outDir,`${reviewId}-${paymentRef.replace(/[^A-Za-z0-9._-]/g,'_')}.json`);fs.writeFileSync(file,JSON.stringify(artifact,null,2),'utf8');
    this.lifecycle.recordEngagement(reviewId,'REVENUE_ATTRIBUTION',{recipientEmail:record.recipient?.email,value:amount,metadata:{currency,paymentRef,sourceType,sourceId,campaignId,contentAssetId,artifact:file}});
    this.lifecycle.completeStage(reviewId,'REVENUE_ATTRIBUTION',{source:`P2GC_REVENUE_ATTRIBUTION:${sourceType}`,freshness:artifact.attributedAt,confidence:'HIGH',verificationState:'CONFIRMED',artifact:file,notes:`Payment ${paymentRef}; ${amount} ${currency}; source ${sourceType}:${sourceId}`});
    return{ok:true,status:'REVENUE_ATTRIBUTION_CONFIRMED',reviewId,file,artifact};
  }
}
module.exports=P2GCFederalGrowthReviewRevenueAttributionService;
