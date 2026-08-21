"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueOutboundReadinessAuditService");
const { campaignSchedule } = require("../SERVICES/revenue/OutboundSendingGovernance");
const { parseArguments } = require("../SCRIPTS/AuditRevenueOutboundReadiness");
let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-readiness-"));
  const writeJson = (name, value) => { const p=path.join(root,name); fs.writeFileSync(p,JSON.stringify(value),"utf8"); return p; };
  const writeJsonl = (name, values) => { const p=path.join(root,name); fs.writeFileSync(p,values.map(JSON.stringify).join("\n")+(values.length?"\n":""),"utf8"); return p; };
  const names = ["GSA","VA","SAM"];
  const senders = Array.from({length:10},(_,i)=>`sender${i+1}@outreach.example`);
  const configurationPath = writeJson("configuration.json", {ok:true,status:"SEGMENT_CONFIGURATION_COMPLETED",configurationApplyFingerprint:"A".repeat(64),routes:names.map((route,index)=>({route,campaignId:`campaign-${index}`}))});
  const configurationPlanPath = writeJson("configuration-plan.json", {ok:true,status:"ALL_SEGMENT_CONFIGURATION_PLANNED",routes:names.map((route,index)=>({route,currentCampaignId:`campaign-${index}`}))});
  const uploadPath = writeJson("upload.json", {ok:true,status:"UPLOAD_COMPLETED",uploadFingerprint:"B".repeat(64),summary:{uploaded:37}});
  const masterPath = writeJsonl("master.jsonl", Array.from({length:57},(_,i)=>({email:`lead-${i}@example.com`})));
  const riskyPath = writeJsonl("risky.jsonl", [{email:"risky@example.com"}]);
  const invalidPath = writeJsonl("invalid.jsonl", [{email:"invalid@example.com"}]);
  const replyRoutingPath = writeJson("reply.json", {ok:true,positive:"positive",negative:"no",neutral:"nurture",technical:"technical",outOfOffice:"out_of_office"});
  const routeSenders = index => index===0 ? senders.slice(0,4) : index===1 ? senders.slice(4,7) : senders.slice(7);
  const campaigns = new Map(names.map((name,index)=>[`campaign-${index}`,{
    id:`campaign-${index}`,status:2,email_list:routeSenders(index),daily_limit:routeSenders(index).length*25,
    campaign_schedule:campaignSchedule(),stop_on_reply:true,stop_on_auto_reply:true,allow_risky_contacts:false,disable_bounce_protect:false,
    sequences:[{steps:Array.from({length:4},(_,step)=>({subject:`Subject ${step}`,body:`Body ${step}`}))}]
  }]));
  const accounts = senders.map(value=>({email:value,status:1}));
  const make = overrides => new Service({rootDir:root,configurationPath,configurationPlanPath,uploadPath,masterPath,riskyPath,invalidPath,replyRoutingPath,outputRoot:path.join(root,overrides?.out||"output"),generatedAt:()=>"2026-08-20T23:00:00-04:00",campaignProvider:async id=>campaigns.get(id),accountProvider:async()=>({items:accounts}),...overrides});
  const service=make();

  await test("service is constructable",async()=>assert.ok(service));
  const preview=await service.audit({});
  await test("default mode is plan-only",async()=>assert.strictEqual(preview.mode,"PLAN_ONLY"));
  await test("plan performs no provider reads",async()=>assert.strictEqual(preview.providerReadsAuthorized,false));
  await test("apply requires live flag",async()=>assert.rejects(()=>service.audit({apply:true}),/--live/));
  const report=await service.audit({apply:true,live:true});
  await test("audit completes",async()=>assert.strictEqual(report.status,"OUTBOUND_READINESS_AUDITED"));
  await test("dynamic readiness passes",async()=>assert.strictEqual(report.readyToLaunch,true));
  await test("configured route count is dynamic",async()=>assert.strictEqual(report.summary.campaignsAudited,3));
  await test("ten unique senders are accepted",async()=>assert.strictEqual(report.summary.uniqueSenders,10));
  await test("verified master count is dynamic",async()=>assert.strictEqual(report.summary.verifiedLeads,57));
  await test("upload count is evidence not historical constant",async()=>assert.strictEqual(report.sourceEvidence.uploaded,37));
  await test("send windows comply",async()=>assert.strictEqual(report.summary.sendWindowCompliant,3));
  await test("sender capacity complies",async()=>assert.strictEqual(report.summary.senderCapacityCompliant,3));
  await test("suppression has no conflicts",async()=>assert.strictEqual(report.suppression.ok,true));
  await test("reply routing is healthy",async()=>assert.strictEqual(report.replyRouting.ok,true));
  await test("provider writes remain unauthorized",async()=>assert.strictEqual(report.providerWritesAuthorized,false));
  await test("no emails send",async()=>assert.strictEqual(report.emailsSent,false));
  await test("readiness fingerprint is recorded",async()=>assert.match(report.readinessFingerprint,/^[A-F0-9]{64}$/));
  await test("CLI defaults safely",async()=>assert.deepStrictEqual(parseArguments([]),{apply:false,live:false}));
  await test("CLI parses live audit",async()=>assert.deepStrictEqual(parseArguments(["--apply","--live"]),{apply:true,live:true}));

  campaigns.get("campaign-0").campaign_schedule.schedules[0].timezone="America/Detroit";
  const wrongSchedule=await make({out:"wrong-schedule"}).audit({apply:true,live:true});
  await test("wrong timezone fails closed",async()=>assert.ok(wrongSchedule.routes[0].blockers.includes("SEND_WINDOW_POLICY_FAILED")));
  campaigns.get("campaign-0").campaign_schedule=campaignSchedule();

  campaigns.get("campaign-1").daily_limit=76;
  const overCapacity=await make({out:"over-capacity"}).audit({apply:true,live:true});
  await test("over-capacity campaign fails closed",async()=>assert.ok(overCapacity.routes[1].blockers.includes("SENDER_CAPACITY_POLICY_FAILED")));
  campaigns.get("campaign-1").daily_limit=75;

  const duplicateMaster=writeJsonl("duplicate-master.jsonl",[{email:"same@example.com"},{email:"same@example.com"}]);
  const duplicateService=make({masterPath:duplicateMaster,out:"duplicate-master"});
  await test("duplicate verified master fails closed",async()=>assert.rejects(()=>duplicateService.audit({apply:true,live:true}),/duplicate emails/));

  console.log(`REVENUE_OUTBOUND_READINESS_AUDIT_TEST_PASS ${passed}/21`);
  fs.rmSync(root,{recursive:true,force:true});
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
