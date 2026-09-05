'use strict';

const fs=require('fs');
const path=require('path');
const P2GCIntentLiveSourceIngestionService=require('./P2GCIntentLiveSourceIngestionService');
const P2GCIntentBusinessDayRunner=require('./P2GCIntentBusinessDayRunner');

function atomicWrite(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); }

class P2GCIntentProductionScheduler {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.ingestion=options.ingestion||new P2GCIntentLiveSourceIngestionService({rootDir:this.rootDir});
    this.runner=options.runner||new P2GCIntentBusinessDayRunner({rootDir:this.rootDir});
    this.now=options.now||(()=>new Date());
    this.timeZone=options.timeZone||process.env.P2GC_INTENT_TIME_ZONE||'America/New_York';
    this.startHour=Number(options.startHour??process.env.P2GC_INTENT_START_HOUR??8);
    this.endHour=Number(options.endHour??process.env.P2GC_INTENT_END_HOUR??17);
    this.pollMs=Math.max(15*60*1000,Number(options.pollMs??process.env.P2GC_INTENT_SCHEDULER_POLL_MS??60*60*1000));
    this.statusFile=options.statusFile||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','production_scheduler_status.json');
    this.timer=null;
    this.running=false;
  }

  localParts(date=this.now()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:this.timeZone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(date);
    return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  }

  inOperatingWindow(date=this.now()){
    const p=this.localParts(date);
    if(['Sat','Sun'].includes(p.weekday)) return false;
    const hour=Number(p.hour);
    return hour>=this.startHour && hour<this.endHour;
  }

  async tick(options={}){
    if(this.running) return {ok:true,status:'INTENT_PRODUCTION_SCHEDULER_TICK_ALREADY_RUNNING',executed:false};
    const now=this.now();
    if(!this.inOperatingWindow(now) && options.force!==true){
      const result={ok:true,status:'INTENT_PRODUCTION_SCHEDULER_OUTSIDE_WINDOW',executed:false,at:now.toISOString(),safety:{outboundSendPerformed:false,providerMutationPerformed:false}};
      atomicWrite(this.statusFile,result); return result;
    }
    this.running=true;
    try{
      const ingestion=await this.ingestion.run();
      if(!ingestion.ok){
        const result={ok:false,status:'INTENT_PRODUCTION_SCHEDULER_INGESTION_BLOCKED',executed:true,at:now.toISOString(),ingestion,safety:{outboundSendPerformed:false,providerMutationPerformed:false}};
        atomicWrite(this.statusFile,result); return result;
      }
      const businessDay=this.runner.run({force:options.force===true,executeWorkbookWrite:options.executeWorkbookWrite===true});
      const result={ok:businessDay.ok===true,status:businessDay.ok===true?'INTENT_PRODUCTION_SCHEDULER_GREEN':'INTENT_PRODUCTION_SCHEDULER_PIPELINE_FAILED',executed:true,at:now.toISOString(),ingestion,businessDay,safety:{outboundSendPerformed:false,providerMutationPerformed:false}};
      atomicWrite(this.statusFile,result); return result;
    } finally { this.running=false; }
  }

  start(){
    if(this.timer) return this;
    this.tick().catch(err=>atomicWrite(this.statusFile,{ok:false,status:'INTENT_PRODUCTION_SCHEDULER_EXCEPTION',at:this.now().toISOString(),error:String(err?.message||err),safety:{outboundSendPerformed:false,providerMutationPerformed:false}}));
    this.timer=setInterval(()=>this.tick().catch(err=>atomicWrite(this.statusFile,{ok:false,status:'INTENT_PRODUCTION_SCHEDULER_EXCEPTION',at:this.now().toISOString(),error:String(err?.message||err),safety:{outboundSendPerformed:false,providerMutationPerformed:false}})),this.pollMs);
    this.timer.unref?.();
    return this;
  }

  stop(){ if(this.timer){ clearInterval(this.timer); this.timer=null; } }
}

if(require.main===module){
  const scheduler=new P2GCIntentProductionScheduler();
  scheduler.start();
  process.on('SIGINT',()=>{scheduler.stop();process.exit(0);});
  process.on('SIGTERM',()=>{scheduler.stop();process.exit(0);});
}

module.exports=P2GCIntentProductionScheduler;
