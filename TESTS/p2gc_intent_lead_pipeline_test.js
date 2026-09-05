'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const P2GCIntentLeadPipelineService=require('../SERVICES/revenue/P2GCIntentLeadPipelineService');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-intent-pipeline-'));
try{
  const writerCalls=[];
  const writer=(row,ctx)=>{ writerCalls.push({row,ctx}); return {ok:true,status:ctx.execute?'WARM_PIPELINE_UPSERT_GREEN':'WARM_PIPELINE_UPSERT_PLANNED',action:'APPEND',mutationPerformed:ctx.execute,sourceUrl:row['Source URL']}; };
  const service=new P2GCIntentLeadPipelineService({rootDir:root,writer,workbookPath:'C:/P2GC/master.xlsx',executeWorkbookWrites:false});
  const signal={company:'Acme Federal LLC',website:'https://acme.example',contactName:'Jane Owner',email:'jane@acme.example',sourcePlatform:'LinkedIn',sourceUrl:'https://linkedin.com/posts/acme',originalPostDate:new Date().toISOString().slice(0,10),needSummary:'Needs help getting GSA sales.',excerpt:'We have a GSA Schedule but no sales and need help.',signalType:'GSA_HELP',fitRationale:'P2GC GSA activation fit'};
  const planned=service.ingest(signal,{executeWorkbookWrite:true});
  assert.strictEqual(planned.ok,true);
  assert.strictEqual(planned.status,'INTENT_PIPELINE_WARM_MASTER_PLANNED');
  assert.strictEqual(planned.canonical.temperature,'HOT');
  assert.strictEqual(planned.workbook.mutationPerformed,false);
  assert.strictEqual(planned.workbook.writeAuthorized,false);
  assert.strictEqual(planned.safety.outboundSendPerformed,false);
  assert.strictEqual(planned.safety.providerMutationPerformed,false);
  assert.strictEqual(writerCalls.length,1);
  assert.strictEqual(writerCalls[0].ctx.execute,false);
  assert.strictEqual(writerCalls[0].row['Source URL'],'https://linkedin.com/posts/acme');

  const enabledCalls=[];
  const enabled=new P2GCIntentLeadPipelineService({rootDir:path.join(root,'enabled'),writer:(row,ctx)=>{enabledCalls.push(ctx);return {ok:true,status:'WARM_PIPELINE_UPSERT_GREEN',action:'APPEND',mutationPerformed:ctx.execute};},workbookPath:'C:/P2GC/master.xlsx',executeWorkbookWrites:true});
  const executed=enabled.ingest(signal,{executeWorkbookWrite:true});
  assert.strictEqual(executed.ok,true);
  assert.strictEqual(executed.status,'INTENT_PIPELINE_WARM_MASTER_UPDATED');
  assert.strictEqual(executed.workbook.writeAuthorized,true);
  assert.strictEqual(executed.workbook.mutationPerformed,true);
  assert.strictEqual(enabledCalls[0].execute,true);

  const rejected=service.ingest({company:'Generic LLC',website:'https://generic.example',sourcePlatform:'LinkedIn',sourceUrl:'https://linkedin.com/posts/generic',originalPostDate:new Date().toISOString().slice(0,10),needSummary:'Won a government contract.',excerpt:'We won.',signalType:'GENERIC_GOVERNMENT_CONTRACTOR'});
  assert.strictEqual(rejected.ok,false);
  assert.strictEqual(rejected.status,'INTENT_PIPELINE_REJECTED');
  assert.strictEqual(writerCalls.length,1);

  const health=service.health();
  assert.strictEqual(health.canonicalIntentReady,true);
  assert.strictEqual(health.warmPipelineContractReady,true);
  assert.strictEqual(health.workbookWriteGateEnabled,false);
  assert.strictEqual(health.outboundSendEnabled,false);
  assert(fs.existsSync(path.join(root,'DATA','runtime','revenue','intent_leads','latest_intent_pipeline_run.json')));
  console.log('P2GC_INTENT_LEAD_PIPELINE_GREEN');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
