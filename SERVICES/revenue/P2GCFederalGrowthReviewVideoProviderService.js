'use strict';

const fs=require('fs');
const path=require('path');
const Lifecycle=require('./P2GCFederalGrowthReviewLifecycleService');

function clean(v){return String(v==null?'':v).trim();}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}

class P2GCFederalGrowthReviewVideoProviderService{
  constructor(options={}){
    this.rootDir=options.rootDir||process.env.MILES_ROOT||process.cwd();
    this.lifecycle=options.lifecycle||new Lifecycle({rootDir:this.rootDir});
    this.vidsAuditFile=options.vidsAuditFile||path.join(this.rootDir,'DATA','operational_acceptance','latest_google_vids_editor_avatar_audit.json');
    this.localAuditFile=options.localAuditFile||path.join(this.rootDir,'DATA','operational_acceptance','latest_local_avatar_runtime_audit.json');
  }

  providerState(){
    const vids=readJson(this.vidsAuditFile);
    const local=readJson(this.localAuditFile);
    const googleProven=vids?.status==='PATHWAYS_GOOGLE_VIDS_AI_AVATAR_PROVEN'&&vids?.editor?.avatarVisible===true;
    const googleEditorOnly=/PATHWAYS_GOOGLE_VIDS_(?:START_MENU|EDITOR)_PROVEN/.test(clean(vids?.status));
    const localReady=local?.recommendation?.localTalkingAvatarCandidate===true;
    const localCpuPotential=local?.recommendation?.cpuOnlyCandidate===true||local?.recommendation?.cpuTalkingAvatarPotential===true;
    return {
      google:{proven:googleProven,editorProven:googleEditorOnly,status:vids?.status||'NO_AUDIT',account:vids?.selected?.email||null},
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

  prepareReview(reviewId){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    if(record.stageState?.PERSONALIZED_SCRIPT?.status!=='COMPLETE')throw new Error('PERSONALIZED_SCRIPT_REQUIRED');
    const selected=this.selectProvider();
    record.presentation=record.presentation||{};
    record.presentation.providerDecision=selected;
    record.presentation.videoStatus=selected.ok?'PROVIDER_READY':'BLOCKED_PROVIDER_NOT_PROVEN';
    record.presentation.mediaId=record.presentation.mediaId||null;
    record.green=false;
    this.lifecycle.write(record);
    if(!selected.ok)this.lifecycle.blockStage(reviewId,'PROFESSIONAL_AI_DEMO',{notes:selected.blockers.join('; ')});
    return {reviewId,...selected,videoStatus:record.presentation.videoStatus};
  }

  markVideoReady(reviewId,input={}){
    const record=this.lifecycle.read(reviewId);if(!record)throw new Error('REVIEW_NOT_FOUND');
    const provider=clean(input.provider).toUpperCase();
    if(!['GOOGLE_VIDS','LOCAL_OPEN_SOURCE','HEYGEN'].includes(provider))throw new Error('SUPPORTED_VIDEO_PROVIDER_REQUIRED');
    if(!clean(input.mediaId))throw new Error('VIDEO_MEDIA_ID_REQUIRED');
    if(!Number.isFinite(Number(input.durationSeconds))||Number(input.durationSeconds)<=0)throw new Error('VIDEO_DURATION_REQUIRED');
    record.presentation=record.presentation||{};
    record.presentation.videoStatus='READY';
    record.presentation.provider=provider;
    record.presentation.mediaId=clean(input.mediaId);
    record.presentation.durationSeconds=Number(input.durationSeconds);
    record.presentation.readyAt=new Date().toISOString();
    this.lifecycle.write(record);
    this.lifecycle.completeStage(reviewId,'PROFESSIONAL_AI_DEMO',{source:`P2GC_VIDEO_PROVIDER:${provider}`,freshness:record.presentation.readyAt,confidence:'HIGH',verificationState:'CONFIRMED',notes:`Video ready; duration ${record.presentation.durationSeconds}s`});
    return {ok:true,status:'PROFESSIONAL_AI_DEMO_READY',reviewId,provider,mediaId:record.presentation.mediaId,durationSeconds:record.presentation.durationSeconds};
  }
}

module.exports=P2GCFederalGrowthReviewVideoProviderService;
