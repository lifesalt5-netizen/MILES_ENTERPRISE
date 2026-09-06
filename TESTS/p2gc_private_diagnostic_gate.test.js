'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const Pipeline=require('../SERVICES/revenue/P2GCCompanySpecificOutboundPipelineService');
const Policy=require('../SERVICES/revenue/P2GCMarketingSalesOperatingPolicy');
const Controller=require('../SERVICES/revenue/P2GCPrivateDiagnosticHttpController');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-private-diag-'));
const dataDir=path.join(root,'DATA','marketing_activity');
fs.mkdirSync(dataDir,{recursive:true});
const token='ABCDEFGHIJKLMNOPQRSTUVWX12345678';
const stateFile=path.join(dataDir,'company_specific_pipeline.json');
const diagnosticFile=path.join(dataDir,'diagnostics.json');
const baseRow={id:'pipe-1',company:'Acme Federal LLC',contact:'Taylor Smith',email:'taylor@acme.example',segment:'P2GC – Agency Expansion',diagnosticId:'diag-1',diagnosticToken:token,privatePath:`/r/${token}`,status:'DIAGNOSTIC_PREPARED_BEFORE_OUTREACH',positiveReply:false,privateLinkReleasedAt:null,coldSequence:{step:1,replyReceived:false,stopped:false}};
fs.writeFileSync(stateFile,JSON.stringify([baseRow],null,2));
fs.writeFileSync(diagnosticFile,JSON.stringify([{id:'diag-1',token,company:'Acme Federal LLC',contact:'Taylor Smith',createdAt:new Date().toISOString(),findings:[{label:'CONFIRMED FACT',finding:'Agency concentration is material.',source:'USAspending',asOfDate:'2026-09-06',metricDefinition:'Share of federal obligations from the largest agency.'}],strongestFindings:[{label:'CONFIRMED FACT',finding:'Agency concentration is material.',source:'USAspending',asOfDate:'2026-09-06',metricDefinition:'Share of federal obligations from the largest agency.'}],protect:['Protect current revenue'],expand:['Expand buyer mix'],capture:['Prioritize qualified pursuits'],relevantCurrentOpportunities:[]}],null,2));

const activity={recordActivity(){return {ok:true};},recordQualification(input){return Policy.qualifiesForKevinCalendar(input);},recordDiagnosticInteraction(){return {id:'evt-1'};},refreshSnapshot(){return {diagnostics:{interactions:[]}};}};
const suppression={isSuppressed(){return false;},get(){return null;},upsert(){return {ok:true};}};
const pipeline=new Pipeline({rootDir:root,activityService:activity,suppressionService:suppression});

let reply=pipeline.markReply({pipelineId:'pipe-1',replyText:'No thanks, not right now.'});
assert.strictEqual(reply.ok,true);
assert.strictEqual(reply.positive,false);
let link=pipeline.positiveReplyLinkMessage({pipelineId:'pipe-1',sendingMailbox:'kevin@pathwaysgov.com'});
assert.strictEqual(link.ok,false);
assert.strictEqual(link.code,'POSITIVE_REPLY_REQUIRED_BEFORE_PRIVATE_LINK');

reply=pipeline.markReply({pipelineId:'pipe-1',replyText:'Yes, please send it over.'});
assert.strictEqual(reply.positive,true);
link=pipeline.positiveReplyLinkMessage({pipelineId:'pipe-1',sendingMailbox:'kevin@pathwaysgov.com'});
assert.strictEqual(link.ok,true);
assert(link.privateLink.includes(`/r/${token}`));
assert(link.privateLinkReleasedAt);

const blockedPrimary=pipeline.positiveReplyLinkMessage({pipelineId:'pipe-1',sendingMailbox:'kevin@p2gc.com'});
assert.strictEqual(blockedPrimary.ok,false);
assert.strictEqual(blockedPrimary.code,'P2GC_PRIMARY_DOMAIN_HANDOFF_TOO_EARLY');

const controller=new Controller({rootDir:root,activityService:activity,pipelineService:pipeline});
const access=controller.lookup(token);
assert.strictEqual(access.ok,true);
const publicState=controller.publicDiagnostic(access.diagnostic,access.pipeline);
assert.strictEqual(publicState.company,'Acme Federal LLC');
assert.strictEqual(publicState.qualification.questions.length,4);
assert.strictEqual(publicState.privacy.linkReleasedAfterPositiveReply,true);

const high=Policy.qualifiesForKevinCalendar({fullReviewRequested:true,goal:'Expand into two agencies',executionPreference:'P2GC working with our team',timing:'Now / within 30 days',willingnessToInvest:'Yes — if the path and fit make sense'});
assert.strictEqual(high.highIntent,true);
assert.strictEqual(high.route,'KEVIN_CALENDAR');
const nurture=Policy.qualifiesForKevinCalendar({fullReviewRequested:true,goal:'Learn the market',executionPreference:'Not sure yet',timing:'Just researching right now',willingnessToInvest:'No — we are only gathering information'});
assert.strictEqual(nurture.highIntent,false);
assert.strictEqual(nurture.route,'NURTURE_OR_CONTINUE_QUALIFICATION');

fs.rmSync(root,{recursive:true,force:true});
console.log('p2gc_private_diagnostic_gate.test.js PASS');
