'use strict';

const fs = require('fs');
const path = require('path');

const EVENT_TYPES = new Set(['CLARIFICATION','DISCUSSION','FPR','BAFO','DEBRIEF','AWARD_RESULT','LESSON_LEARNED']);
function text(v){return String(v??'').trim();}
function arr(v){return Array.isArray(v)?v:[];}
function now(){return new Date().toISOString();}

class P2GCPostSubmissionLearningService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.outputDir=options.outputDir||path.join(this.rootDir,'DATA','proposal_command','post_submission');
  }
  normalizeEvent(row={},index=0){
    const type=text(row.type).toUpperCase();
    if(!EVENT_TYPES.has(type)) throw new Error(`INVALID_POST_SUBMISSION_EVENT_TYPE:${type||'MISSING'}`);
    const sourceProof=text(row.sourceProof||row.sourceUrl||row.evidenceRef);
    if(!sourceProof) throw new Error(`POST_SUBMISSION_EVENT_PROOF_REQUIRED:${type}`);
    return {id:text(row.id)||`POST-${index+1}`,type,observedAt:text(row.observedAt)||now(),sourceProof,summary:text(row.summary)||'UNKNOWN',action:text(row.action)||null,outcome:text(row.outcome)||null,verified:true};
  }
  run(input={}){
    const submissionProof=text(input.submissionProof);
    const events=arr(input.events).map((e,i)=>this.normalizeEvent(e,i));
    const result={ok:true,status:submissionProof?'POST_SUBMISSION_LEARNING_ACTIVE':'NOT_APPLICABLE',generatedAt:now(),solicitationId:text(input.solicitationId)||null,submissionProof:submissionProof||null,events:submissionProof?events:[],ignoredWithoutSubmissionProof:submissionProof?0:events.length,rules:{requiresActualSubmissionProof:true,eventEvidenceRequired:true,noFabrication:true}};
    fs.mkdirSync(this.outputDir,{recursive:true});
    result.outputFile=path.join(this.outputDir,'latest.json');
    fs.writeFileSync(result.outputFile,JSON.stringify(result,null,2),'utf8');
    return result;
  }
  healthCheck(){return{ok:true,status:'HEALTHY',service:'P2GC_POST_SUBMISSION_LEARNING',eventTypes:[...EVENT_TYPES],requiresActualSubmissionProof:true,generatedAt:now()};}
}
module.exports=P2GCPostSubmissionLearningService;
module.exports.EVENT_TYPES=EVENT_TYPES;
