'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const Lifecycle=require('./P2GCFederalGrowthReviewLifecycleService');

function clean(v){return String(v==null?'':v).trim();}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function iso(v){const t=Date.parse(clean(v));return Number.isFinite(t)?new Date(t).toISOString():null;}
function words(text){return clean(text).split(/\s+/).filter(Boolean);}
function sha256(value){return crypto.createHash('sha256').update(String(value||''),'utf8').digest('hex');}

class P2GCFederalGrowthReviewVideoProviderService{
  constructor(options={}){
    this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();
    this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});
    this.vidsAuditFile=options.vidsAuditFile||path.join(this.rootDir,'DATA','operational_acceptance','latest_google_vids_editor_avatar_audit.json');
    this.localAuditFile=options.localAuditFile||path.join(this.rootDir,'DATA','operational_acceptance','latest_local_avatar_runtime_audit.json');
    this.googleMaxSegmentWords=Math.max(80,Math.min(125,Number(options.googleMaxSegmentWords||120)));
    this.wordsPerMinute=Math.max(110,Math.min(170,Number(options.wordsPerMinute||135)));
  }

  providerState(){
    const vids=readJson(this.vidsAuditFile);
    const local=readJson(this.localAuditFile);
    const googleProven=vids?.status==='PATHWAYS_GOOGLE_VIDS_AI_AVATAR_PROVEN'&&vids?.editor?.avatarVisible===true;
    const googleEditorOnly=/PATHWAYS_GOOGLE_VIDS_(?:START_MENU|EDITOR)_PROVEN/.test(clean(vids?.status));
    const localReady=local?.recommendation?.localTalkingAvatarCandidate===true;
    const localCpuPotential=local?.recommendation?.cpuOnlyCandidate===true||local?.recommendation?.cpuTalkingAvatarPotential===true;
    return {
      google:{proven:googleProven,editorProven:googleEditorOnly,status:vids?.status||'NO_AUDIT',account:vids?.selected?.email||null,maxAvatarSegmentSeconds:60},
      local:{ready:localReady,cpuPotential:localCpuPotential,status:local?'AUDITED':'NO_AUDIT',ffmpegReady:local?.ffmpeg?.available===true,gpuReady:local?.recommendation?.gpuAcceleratedCandidate===true},
      heygen:{configured:Boolean(clean(process.env.HEYGEN_API_KEY)),paidFallback:true}
    };
  }

  selectProvider(){
    const state=this.providerState();
    if(state.google.proven)return {ok:true,provider:'GOOGLE_VIDS',costPolicy:'ZERO_INCREMENTAL_IF_INCLUDED_IN_EXISTING_WORKSPACE',state};
    if(state.local.ready)return {ok:true,provider:'LOCAL_OPEN_SOURCE',costPolicy:'NO_PAID_SUBSCRIPTION',state};
    return {ok:false,provider:null,status:'VIDEO_PROVIDER_NOT_PRODUCTION_PROVEN',state,blockers:[
      state.google.editorProven?'GOOGLE_VIDS_AI_AVATAR_NOT_PROVEN':'GOOGLE_VIDS_EDITOR_NOT_PROVEN',
      state.local.cpuPotential&&!state.local.ffmpegReady?'LOCAL_FFMPEG_REQUIRED':'LOCAL_AVATAR_RUNTIME_NOT_READY'
    ]};
  }

  buildGoogleSegmentPlan(script){
    const list=words(script);
    if(!list.length)throw new Error('PERSONALIZED_SCRIPT_TEXT_REQUIRED');
    const max=this.googleMaxSegmentWords;
    const segments=[];
    for(let i=0;i<list.length;i+=max){
      const slice=list.slice(i,i+max);
      const estimatedSeconds=Math.max(1,Math.ceil((slice.length/this.wordsPerMinute)*60));
      if(estimatedSeconds>60)throw new Error('GOOGLE_VIDS_SEGMENT_EXCEEDS_60_SECONDS');
      segments.push({
        index:segments.length+1,
        wordCount:slice.length,
        estimatedSeconds,
        script:slice.join(' '),
        scriptSha256:sha256(slice.join(' '))
      });
    }
    return {
      provider:'GOOGLE_VIDS',
      maxSegmentSeconds:60,
      maxSegmentWords:max,
      wordsPerMinute:this.wordsPerMinute,
      totalWords:list.length,
      estimatedTotalSeconds:segments.reduce((n,s)=>n+s.estimatedSeconds,0),
      segmentCount:segments.length,
      segments
    };
  }

  prepareReview(reviewId){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    if(record.stageState?.PERSONALIZED_SCRIPT?.status!=='COMPLETE')throw new Error('PERSONALIZED_SCRIPT_REQUIRED');
    const selected=this.selectProvider();
    record.presentation=record.presentation||{};
    record.presentation.providerDecision=selected;
    record.presentation.videoStatus=selected.ok?'PROVIDER_READY':'BLOCKED_PROVIDER_NOT_PROVEN';
    record.presentation.mediaId=record.presentation.mediaId||null;
    if(selected.provider==='GOOGLE_VIDS') record.presentation.segmentPlan=this.buildGoogleSegmentPlan(record.presentation.script);
    record.green=false;
    this.lifecycle.write(record);
    if(!selected.ok)this.lifecycle.blockStage(reviewId,'PROFESSIONAL_AI_DEMO',{notes:selected.blockers.join('; ')});
    return {reviewId,...selected,videoStatus:record.presentation.videoStatus,segmentPlan:record.presentation.segmentPlan||null};
  }

  validateRenderEvidence(record,provider,input){
    const proof=input.renderEvidence||{};
    const renderedAt=iso(proof.renderedAt);
    if(!renderedAt)throw new Error('VIDEO_RENDERED_AT_REQUIRED');
    if(!clean(proof.providerProjectRef))throw new Error('VIDEO_PROVIDER_PROJECT_REF_REQUIRED');
    if(!clean(proof.artifactRef))throw new Error('VIDEO_ARTIFACT_REF_REQUIRED');
    if(provider==='GOOGLE_VIDS'){
      const plan=record.presentation?.segmentPlan;
      if(!plan||!Array.isArray(plan.segments)||!plan.segments.length)throw new Error('GOOGLE_VIDS_SEGMENT_PLAN_REQUIRED');
      const completed=Number(proof.completedSegmentCount);
      if(!Number.isInteger(completed)||completed!==plan.segmentCount)throw new Error('GOOGLE_VIDS_ALL_SEGMENTS_REQUIRED');
    }
    return {
      renderedAt,
      providerProjectRef:clean(proof.providerProjectRef),
      artifactRef:clean(proof.artifactRef),
      completedSegmentCount:Number(proof.completedSegmentCount||1),
      verifiedBy:clean(proof.verifiedBy||'MILES_PROVIDER_ACCEPTANCE'),
      verificationState:'CONFIRMED'
    };
  }

  markVideoReady(reviewId,input={}){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    const provider=clean(input.provider).toUpperCase();
    if(!['GOOGLE_VIDS','LOCAL_OPEN_SOURCE','HEYGEN'].includes(provider))throw new Error('SUPPORTED_VIDEO_PROVIDER_REQUIRED');
    if(record.presentation?.providerDecision?.provider&&provider!==record.presentation.providerDecision.provider)throw new Error('VIDEO_PROVIDER_MISMATCH');
    if(!clean(input.mediaId))throw new Error('VIDEO_MEDIA_ID_REQUIRED');
    if(!Number.isFinite(Number(input.durationSeconds))||Number(input.durationSeconds)<=0)throw new Error('VIDEO_DURATION_REQUIRED');
    const evidence=this.validateRenderEvidence(record,provider,input);
    record.presentation=record.presentation||{};
    record.presentation.videoStatus='READY';
    record.presentation.provider=provider;
    record.presentation.mediaId=clean(input.mediaId);
    record.presentation.durationSeconds=Number(input.durationSeconds);
    record.presentation.readyAt=evidence.renderedAt;
    record.presentation.renderEvidence=evidence;
    record.presentation.runtimeTargetStatus=Number(input.durationSeconds)>=360&&Number(input.durationSeconds)<=600?'WITHIN_6_TO_10_MINUTE_TARGET':'OUTSIDE_6_TO_10_MINUTE_TARGET';
    this.lifecycle.write(record);
    this.lifecycle.completeStage(reviewId,'PROFESSIONAL_AI_DEMO',{source:`P2GC_VIDEO_PROVIDER:${provider}`,freshness:evidence.renderedAt,confidence:'HIGH',verificationState:'CONFIRMED',notes:`Rendered artifact verified; duration ${record.presentation.durationSeconds}s; segments ${evidence.completedSegmentCount}`});
    return {ok:true,status:'PROFESSIONAL_AI_DEMO_READY',reviewId,provider,mediaId:record.presentation.mediaId,durationSeconds:record.presentation.durationSeconds,runtimeTargetStatus:record.presentation.runtimeTargetStatus,renderEvidence:evidence};
  }
}

module.exports=P2GCFederalGrowthReviewVideoProviderService;
