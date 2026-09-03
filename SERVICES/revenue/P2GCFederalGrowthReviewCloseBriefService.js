'use strict';

const fs=require('fs');
const path=require('path');
const Lifecycle=require('./P2GCFederalGrowthReviewLifecycleService');

function clean(v){return String(v==null?'':v).trim();}
function now(){return new Date().toISOString();}
function questionEvents(record){return(record.engagement||[]).filter(e=>e.type==='QUESTION_SUBMITTED').map(e=>({at:e.at,question:clean(e.metadata?.question),priorityOptionId:clean(e.metadata?.priorityOptionId)||null})).filter(x=>x.question);}
function selectedPriorities(record){const byId=new Map((record.priorityOptions||[]).map(x=>[x.id,x.label]));return[...new Set(questionEvents(record).map(q=>q.priorityOptionId).filter(Boolean).map(id=>byId.get(id)||id))];}

class P2GCFederalGrowthReviewCloseBriefService{
  constructor(options={}){this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});this.outDir=options.outDir||path.join(this.rootDir,'DATA','federal_growth_review_close_briefs');}
  generate(reviewId,options={}){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    if(record.stageState?.ACCURATE_FINDINGS?.status!=='COMPLETE')throw new Error('ACCURATE_FINDINGS_REQUIRED');
    const questions=questionEvents(record);const visible=(record.findings||[]).filter(f=>f.freePreviewVisibility!=='LOCKED');
    const material=visible.filter(f=>f.material!==false&&f.verificationState);
    const engagement=record.engagementSummary||{};
    const brief={
      version:1,reviewId:record.reviewId,generatedAt:now(),generatedFor:'KEVIN',company:{name:record.company?.name||null,uei:record.company?.uei||null,cage:record.company?.cage||null},recipient:{name:record.recipient?.name||null,email:record.recipient?.email||null},
      scores:{fitScore:record.scoring?.fitScore??0,intentScore:record.scoring?.intentScore??0,salesPriority:record.scoring?.salesPriority??0},
      engagement:{authenticatedAccessCount:engagement.authenticatedAccessCount||0,repeatVisitCount:engagement.repeatVisitCount||0,videoStartCount:engagement.videoStartCount||0,maxPlaybackPct:engagement.maxPlaybackPct||0,questionCount:engagement.questionCount||0,schedulingOpenedCount:engagement.schedulingOpenedCount||0,meetingBooked:engagement.meetingBooked===true},
      prospectQuestions:questions,
      prospectPrioritySignals:selectedPriorities(record),
      verifiedFindings:material.slice(0,8).map(f=>({title:f.title,finding:f.finding,businessImpact:f.businessImpact,howP2GCAddressesIt:f.howP2GCAddressesIt,source:f.source,freshness:f.freshness,confidence:f.confidence,verificationState:f.verificationState})),
      callPlan:{
        opening:'Confirm which finding matters most to the prospect before expanding the discussion.',
        firstPriority:selectedPriorities(record)[0]||questions[0]?.question||material[0]?.title||'Ask what the prospect most wants to address first.',
        questionsToResolve:questions.map(q=>q.question),
        evidenceBoundary:'Use only verified/current review findings. UNKNOWN is not ZERO. Do not imply guaranteed awards, revenue, qualification, or unsupported buyer/opportunity fit.',
        closeObjective:'Answer remaining questions, confirm the appropriate P2GC pathway, and agree on the next commercial step if there is mutual fit.'
      },
      commercialGuardrails:{pricingIncluded:false,proposalAutomaticallyAuthorized:false,negotiationAuthority:'KEVIN',finalOfferRequiresKevin:true},
      sourceIntegrity:{findingCount:material.length,questionsCaptured:questions.length,engagementDerived:true,noFabricatedFacts:true}
    };
    fs.mkdirSync(this.outDir,{recursive:true});const file=path.join(this.outDir,`${record.reviewId}.json`);fs.writeFileSync(file,JSON.stringify(brief,null,2),'utf8');
    this.lifecycle.completeStage(reviewId,'KEVIN_CLOSE_BRIEF',{source:'P2GC_CLOSE_BRIEF_GENERATOR',freshness:brief.generatedAt,confidence:'HIGH',verificationState:'CONFIRMED',artifact:file,notes:`Verified findings ${material.length}; prospect questions ${questions.length}`});
    return{ok:true,status:'KEVIN_CLOSE_BRIEF_READY',reviewId,file,brief};
  }
}
module.exports=P2GCFederalGrowthReviewCloseBriefService;
