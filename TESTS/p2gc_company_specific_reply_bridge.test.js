'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Pipeline=require('../SERVICES/revenue/P2GCCompanySpecificOutboundPipelineService');
const ReplyLoop=require('../SERVICES/revenue/ReplyIntelligenceProductionLoopService');

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-reply-diagnostic-'));
  try{
    const marketingDir=path.join(root,'DATA','marketing_activity');fs.mkdirSync(marketingDir,{recursive:true});
    const token='ABCDEFGHIJKLMNOPQRSTUVWX12345678';
    const row={id:'pipe-1',company:'Acme Federal LLC',contact:'Taylor Smith',email:'prospect@example.com',segment:'P2GC – Agency Expansion',diagnosticId:'diag-1',diagnosticToken:token,privatePath:`/r/${token}`,strongestFindings:[{finding:'Agency concentration is material.'}],status:'OUTREACH_SENT',positiveReply:false,privateLinkReleasedAt:null,privateLinkReleasedFrom:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),coldSequence:{step:1,replyReceived:false,stopped:false}};
    fs.writeFileSync(path.join(marketingDir,'company_specific_pipeline.json'),JSON.stringify([row],null,2));
    const activityEvents=[];
    const activity={recordActivity(event){activityEvents.push(event);return {ok:true};},refreshSnapshot(){return {diagnostics:{interactions:[]}};},recordQualification(){return {highIntent:false};}};
    const suppression={get(){return null;},isSuppressed(){return false;},upsert(){return {ok:true};},filePath:path.join(root,'suppression.json')};
    const pipeline=new Pipeline({rootDir:root,activityService:activity,suppressionService:suppression});
    const rawEmail={id:'email-uuid-1',eaccount:'kevin@pathwaysgov.com',from_address_email:'prospect@example.com',campaign_id:'campaign-1',lead_id:'lead-1',subject:'Re: Acme federal growth snapshot',body:{text:'Yes, please send it over.'},timestamp_created:new Date().toISOString()};
    const loop=new ReplyLoop({rootDir:root,emailSource:{async listEmails(){return {items:[rawEmail],next_starting_after:null};}},suppression,surfacePolicy:{queuePath:path.join(root,'exec.json'),apply(x){return {...x,surfaceToExecutiveInbox:Boolean(x.qualifiedPositive)};}},replacementRecovery:{detect(){return null;}},companySpecificPipeline:pipeline});
    const report=await loop.runOnce();
    assert.strictEqual(report.ok,true);
    assert.strictEqual(report.companySpecificRepliesMatched,1);
    assert.strictEqual(report.privateDiagnosticHandoffsPrepared,1);
    assert.strictEqual(report.governedRepliesReady,1);
    const queue=JSON.parse(fs.readFileSync(path.join(root,'DATA','runtime','revenue','replies','qualified_reply_queue.json'),'utf8'));
    assert.strictEqual(queue.length,1);
    const operation=queue[0];
    assert.strictEqual(operation.status,'READY');
    assert.strictEqual(operation.action,'replyToEmail');
    assert.strictEqual(operation.conversionPath,'PRIVATE_DIAGNOSTIC_BEFORE_CALENDAR');
    assert.strictEqual(operation.companySpecificPipelineId,'pipe-1');
    assert.strictEqual(operation.diagnosticId,'diag-1');
    assert.strictEqual(operation.calendlyIncluded,false);
    assert(operation.body.text.includes(`/r/${token}`));
    assert(!/calendly/i.test(operation.body.text));
    assert(operation.requiredGates.includes('QUALIFICATION_BEFORE_KEVIN_CALENDAR'));
    const after=JSON.parse(fs.readFileSync(path.join(marketingDir,'company_specific_pipeline.json'),'utf8'))[0];
    assert.strictEqual(after.positiveReply,true);
    assert.strictEqual(after.status,'PRIVATE_DIAGNOSTIC_LINK_RELEASED');
    assert.strictEqual(after.privateLinkReleasedFrom,'kevin@pathwaysgov.com');
    assert(activityEvents.some(x=>x.action==='POSITIVE_REPLY_DIAGNOSTIC_REQUEST'));
    assert(activityEvents.some(x=>x.action==='PRIVATE_DIAGNOSTIC_LINK_RELEASED_AFTER_POSITIVE_REPLY'));

    // Protected-domain sender must fail closed and must never fall through to a Calendly reply.
    after.status='OUTREACH_SENT';after.positiveReply=false;after.privateLinkReleasedAt=null;after.privateLinkReleasedFrom=null;after.updatedAt=new Date(Date.now()+1000).toISOString();
    fs.writeFileSync(path.join(marketingDir,'company_specific_pipeline.json'),JSON.stringify([after],null,2));
    fs.rmSync(path.join(root,'DATA','runtime','revenue','replies'),{recursive:true,force:true});
    const blockedEmail={...rawEmail,id:'email-uuid-2',eaccount:'kevin@p2gc.com',timestamp_created:new Date(Date.now()+2000).toISOString()};
    const loop2=new ReplyLoop({rootDir:root,emailSource:{async listEmails(){return {items:[blockedEmail],next_starting_after:null};}},suppression,surfacePolicy:{queuePath:path.join(root,'exec2.json'),apply(x){return {...x,surfaceToExecutiveInbox:Boolean(x.qualifiedPositive)};}},replacementRecovery:{detect(){return null;}},companySpecificPipeline:pipeline});
    const blockedReport=await loop2.runOnce();
    assert.strictEqual(blockedReport.ok,true);
    const blockedQueue=JSON.parse(fs.readFileSync(path.join(root,'DATA','runtime','revenue','replies','qualified_reply_queue.json'),'utf8'));
    assert.strictEqual(blockedQueue.length,1);
    assert.strictEqual(blockedQueue[0].status,'REVIEW_REQUIRED');
    assert.strictEqual(blockedQueue[0].conversionPath,'PRIVATE_DIAGNOSTIC_BEFORE_CALENDAR');
    assert.strictEqual(blockedQueue[0].body.text,'');
    assert.strictEqual(blockedQueue[0].nextAction,'HOLD_PRIVATE_LINK_UNTIL_SAFE_SECONDARY_SENDER');
    assert(!/calendly/i.test(blockedQueue[0].body.text));

    console.log('p2gc_company_specific_reply_bridge.test.js PASS');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
