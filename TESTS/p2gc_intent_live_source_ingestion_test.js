'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const P2GCIntentLiveSourceIngestionService=require('../SERVICES/revenue/P2GCIntentLiveSourceIngestionService');

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-intent-live-source-'));
  try{
    const now=new Date('2026-09-05T12:00:00Z');
    const payload={items:[
      {company:'Acme Federal LLC',url:'https://example.com/post/1',publishedAt:'2026-09-04T15:00:00Z',title:'Need help with an RFP response',body:'We are looking for proposal support for a federal RFP due soon.',author:'Jane Doe'},
      {company:'Acme Federal LLC',url:'https://example.com/post/1',publishedAt:'2026-09-04T15:00:00Z',title:'Need help with an RFP response',body:'We are looking for proposal support for a federal RFP due soon.',author:'Jane Doe'},
      {company:'Generic Co',url:'https://example.com/post/2',publishedAt:'2026-09-04T15:00:00Z',title:'Hiring update',body:'We are hiring a commercial account executive.'},
      {url:'https://example.com/post/3',publishedAt:'2026-09-04T15:00:00Z',title:'Need GSA help',body:'Looking for a GSA consultant to improve our schedule sales.'}
    ]};
    const fetchImpl=async()=>({ok:true,status:200,json:async()=>payload});
    const svc=new P2GCIntentLiveSourceIngestionService({rootDir:root,fetchImpl,now:()=>now});
    const manifest={sources:[{name:'TEST_PUBLIC_FEED',platform:'PUBLIC_FORUM',url:'https://feed.example.test/items',itemsPath:'items'}]};
    const result=await svc.run({manifest});
    assert.strictEqual(result.ok,true);
    assert.strictEqual(result.status,'INTENT_LIVE_SOURCE_INGESTION_GREEN');
    assert.strictEqual(result.observed,4);
    assert.strictEqual(result.qualified,1);
    assert.strictEqual(result.rejected,2);
    assert.strictEqual(result.failedSources,0);
    assert.strictEqual(result.safety.outboundSendPerformed,false);
    assert.strictEqual(result.safety.providerMutationPerformed,false);

    const signalFile=path.join(root,'DATA','runtime','revenue','intent_leads','discovered_signals.json');
    const artifact=JSON.parse(fs.readFileSync(signalFile,'utf8'));
    assert.strictEqual(artifact.signals.length,1);
    assert.strictEqual(artifact.signals[0].company,'Acme Federal LLC');
    assert.strictEqual(artifact.signals[0].signalType,'PROPOSAL_HELP');
    assert.strictEqual(artifact.signals[0].sourcePlatform,'PUBLIC_FORUM');
    assert.strictEqual(artifact.signals[0].sourceUrl,'https://example.com/post/1');
    assert.ok(artifact.signals[0].sourceEvidenceHash);

    const blocked=new P2GCIntentLiveSourceIngestionService({rootDir:path.join(root,'empty'),fetchImpl,now:()=>now});
    const noSources=await blocked.run({manifest:{sources:[]}});
    assert.strictEqual(noSources.ok,false);
    assert.strictEqual(noSources.status,'INTENT_LIVE_SOURCE_BLOCKED_NO_SOURCES');

    const badHttp=new P2GCIntentLiveSourceIngestionService({rootDir:path.join(root,'http'),fetchImpl:async()=>({ok:false,status:503}),now:()=>now});
    const partial=await badHttp.run({manifest});
    assert.strictEqual(partial.ok,false);
    assert.strictEqual(partial.status,'INTENT_LIVE_SOURCE_INGESTION_PARTIAL');
    assert.strictEqual(partial.failedSources,1);
    assert.strictEqual(partial.qualified,0);

    console.log('P2GC_INTENT_LIVE_SOURCE_INGESTION_GREEN');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(err=>{console.error(err);process.exit(1);});
