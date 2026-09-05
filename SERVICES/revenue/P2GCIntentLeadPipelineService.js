'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const P2GCIntentLeadCanonicalService = require('./P2GCIntentLeadCanonicalService');
const P2GCWarmPipelineContractService = require('./P2GCWarmPipelineContractService');

function bool(v){ return ['1','true','yes','y','on'].includes(String(v ?? '').trim().toLowerCase()); }
function clean(v){ return String(v ?? '').trim(); }

class P2GCIntentLeadPipelineService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.canonical=options.canonical||new P2GCIntentLeadCanonicalService({rootDir:this.rootDir});
    this.contract=options.contract||new P2GCWarmPipelineContractService({rootDir:this.rootDir,workbookPath:options.workbookPath});
    this.writer=options.writer||null;
    this.workbookPath=options.workbookPath||process.env.P2GC_WARM_PIPELINE_XLSX||this.contract.workbookPath;
    this.writerScript=options.writerScript||path.join(this.rootDir,'SCRIPTS','UpsertP2GCWarmPipelineWorkbook.ps1');
    this.executeWorkbookWrites=options.executeWorkbookWrites!==undefined?Boolean(options.executeWorkbookWrites):bool(process.env.P2GC_INTENT_WARM_PIPELINE_WRITE_ENABLED);
    this.outputDir=options.outputDir||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads');
    this.latestPath=path.join(this.outputDir,'latest_intent_pipeline_run.json');
  }

  runWriter(row,{execute=false}={}){
    if(this.writer) return this.writer(row,{execute,workbookPath:this.workbookPath});
    if(!clean(this.workbookPath) || !fs.existsSync(this.workbookPath)){
      return {ok:false,status:'WARM_PIPELINE_WORKBOOK_NOT_AVAILABLE',workbookPath:this.workbookPath||null,mutationPerformed:false};
    }
    if(!fs.existsSync(this.writerScript)) return {ok:false,status:'WARM_PIPELINE_WRITER_MISSING',writerScript:this.writerScript,mutationPerformed:false};
    if(process.platform!=='win32') return {ok:false,status:'WARM_PIPELINE_WRITER_REQUIRES_WINDOWS',mutationPerformed:false};
    const temp=path.join(os.tmpdir(),`p2gc-intent-row-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    try{
      fs.writeFileSync(temp,JSON.stringify(row,null,2),'utf8');
      const ps=process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';
      const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.writerScript,'-WorkbookPath',this.workbookPath,'-RowJsonPath',temp];
      if(!execute) args.push('-PlanOnly');
      const raw=execFileSync(ps,args,{cwd:this.rootDir,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:120000});
      const parsed=JSON.parse(String(raw||'').trim());
      return parsed;
    } catch(error){
      return {ok:false,status:'WARM_PIPELINE_WRITER_FAILED',error:String(error.stderr||error.stdout||error.message||error).slice(-5000),mutationPerformed:false};
    } finally { try{fs.unlinkSync(temp)}catch{} }
  }

  ingest(signal,options={}){
    const canonical=this.canonical.upsert(signal||{});
    if(!canonical.ok){
      return {ok:false,status:'INTENT_PIPELINE_REJECTED',canonical,workbook:{attempted:false,mutationPerformed:false}};
    }
    const row=this.contract.mapLead(canonical.record);
    const writeAuthorized=options.executeWorkbookWrite===true && this.executeWorkbookWrites===true;
    const workbook=this.runWriter(row,{execute:writeAuthorized});
    const outcome={
      ok:canonical.ok && workbook.ok===true,
      status:workbook.ok===true?(workbook.mutationPerformed?'INTENT_PIPELINE_WARM_MASTER_UPDATED':'INTENT_PIPELINE_WARM_MASTER_PLANNED'):'INTENT_PIPELINE_CANONICAL_ONLY',
      canonical:{status:canonical.status,created:canonical.created,signalAdded:canonical.signalAdded,recordId:canonical.record.id,temperature:canonical.record.leadTemperature,category:canonical.record.leadCategory},
      workbook:{...workbook,writeAuthorized},
      safety:{outboundSendPerformed:false,providerMutationPerformed:false,workbookWriteRequested:options.executeWorkbookWrite===true,workbookWriteGateEnabled:this.executeWorkbookWrites},
      generatedAt:new Date().toISOString()
    };
    fs.mkdirSync(this.outputDir,{recursive:true});
    fs.writeFileSync(this.latestPath,JSON.stringify(outcome,null,2),'utf8');
    return outcome;
  }

  ingestBatch(signals=[],options={}){
    const rows=Array.isArray(signals)?signals:[];
    const results=rows.map(signal=>this.ingest(signal,options));
    return {
      ok:results.every(x=>x.ok || x.status==='INTENT_PIPELINE_CANONICAL_ONLY'),
      observed:rows.length,
      qualified:results.filter(x=>x.canonical?.recordId).length,
      rejected:results.filter(x=>x.status==='INTENT_PIPELINE_REJECTED').length,
      workbookUpdated:results.filter(x=>x.workbook?.mutationPerformed===true).length,
      workbookPlanned:results.filter(x=>x.workbook?.ok===true&&x.workbook?.mutationPerformed!==true).length,
      results,
      generatedAt:new Date().toISOString()
    };
  }

  health(){
    return {
      ok:true,
      service:'P2GC_INTENT_LEAD_PIPELINE',
      canonicalIntentReady:true,
      warmPipelineContractReady:true,
      writerPresent:fs.existsSync(this.writerScript),
      workbookConfigured:Boolean(clean(this.workbookPath)),
      workbookExists:Boolean(clean(this.workbookPath)&&fs.existsSync(this.workbookPath)),
      workbookWriteGateEnabled:this.executeWorkbookWrites,
      outboundSendEnabled:false
    };
  }
}

module.exports=P2GCIntentLeadPipelineService;
