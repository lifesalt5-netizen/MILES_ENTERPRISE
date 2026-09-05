'use strict';

const fs=require('fs');
const path=require('path');
const P2GCIntentLeadPipelineService=require('./P2GCIntentLeadPipelineService');

function clean(v){ return String(v??'').trim(); }
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;} }
function atomicWrite(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); }

class P2GCIntentBusinessDayRunner {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.pipeline=options.pipeline||new P2GCIntentLeadPipelineService({rootDir:this.rootDir,workbookPath:options.workbookPath});
    this.now=options.now||(()=>new Date());
    this.timeZone=options.timeZone||process.env.P2GC_INTENT_TIME_ZONE||'America/New_York';
    this.signalFile=options.signalFile||process.env.P2GC_INTENT_DISCOVERY_SIGNAL_FILE||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','discovered_signals.json');
    this.stateFile=options.stateFile||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','business_day_runner_state.json');
    this.latestFile=options.latestFile||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','latest_business_day_run.json');
  }

  localParts(date=this.now()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:this.timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hour12:false}).formatToParts(date);
    return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  }

  runKey(date=this.now()){ const p=this.localParts(date); return `${p.year}-${p.month}-${p.day}`; }
  isBusinessDay(date=this.now()){ return !['Sat','Sun'].includes(this.localParts(date).weekday); }
  loadSignals(){ const raw=readJson(this.signalFile,[]); return Array.isArray(raw)?raw:(Array.isArray(raw.signals)?raw.signals:[]); }

  run(options={}){
    const now=this.now();
    const key=this.runKey(now);
    const state=readJson(this.stateFile,{version:1,lastCompletedRunKey:null,runs:[]});
    if(!this.isBusinessDay(now) && options.force!==true) return {ok:true,status:'INTENT_BUSINESS_DAY_SKIPPED_WEEKEND',runKey:key,executed:false};
    if(state.lastCompletedRunKey===key && options.force!==true) return {ok:true,status:'INTENT_BUSINESS_DAY_ALREADY_COMPLETE',runKey:key,executed:false};

    const signals=options.signals||this.loadSignals();
    const batch=this.pipeline.ingestBatch(signals,{executeWorkbookWrite:options.executeWorkbookWrite===true});
    const outcome={ok:batch.ok===true,status:batch.ok===true?'INTENT_BUSINESS_DAY_RUN_GREEN':'INTENT_BUSINESS_DAY_RUN_FAILED',runKey:key,executed:true,signalFile:this.signalFile,observed:batch.observed,qualified:batch.qualified,rejected:batch.rejected,workbookUpdated:batch.workbookUpdated,workbookPlanned:batch.workbookPlanned,generatedAt:now.toISOString(),safety:{outboundSendPerformed:false,providerMutationPerformed:false}};
    fs.mkdirSync(path.dirname(this.latestFile),{recursive:true});
    atomicWrite(this.latestFile,outcome);
    state.runs=Array.isArray(state.runs)?state.runs:[];
    state.runs.push(outcome);
    state.runs=state.runs.slice(-90);
    if(outcome.ok) state.lastCompletedRunKey=key;
    atomicWrite(this.stateFile,state);
    return outcome;
  }
}

module.exports=P2GCIntentBusinessDayRunner;
