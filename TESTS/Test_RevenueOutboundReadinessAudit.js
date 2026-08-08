"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueOutboundReadinessAuditService");
const { parseArguments } = require("../SCRIPTS/AuditRevenueOutboundReadiness");
let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-readiness-"));
  const writeJson = (name, value) => { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(value), "utf8"); return p; };
  const writeJsonl = (name, values) => { const p = path.join(root, name); fs.writeFileSync(p, values.map(JSON.stringify).join("\n") + (values.length ? "\n" : ""), "utf8"); return p; };
  const names = ["Expiring GSA 12 Months","Expiring VA 12 Months","GSA","VA","8(a)","HUBZone","SDVOSB","VOSB","WOSB","SBS"];
  const senders = ["contacts@pathwaysgsa.com","info@pathwaysgsa.com","kevin@pathwaysgsa.com","cora@pathwaysgovcon.com","evan@pathwaysgovcon.com","maya@pathwaysgovcon.com","silvia@pathwaysgovcon.com","victoria@pathwaysgovcon.com","kevin@pathwaysgov.com"];
  const routeSenders = name => /gsa/i.test(name) ? senders.slice(0,3) : name === "SBS" ? senders.slice(8) : senders.slice(3,8);
  const configurationPath = writeJson("configuration.json", { ok:true, status:"SEGMENT_CONFIGURATION_COMPLETED", configurationApplyFingerprint:"A".repeat(64), summary:{classifiedRoutes:10}, routes:names.map((route,index)=>({route,campaignId:index < 2 ? "campaign-"+index : null})) });
  const configurationPlanPath = writeJson("configuration-plan.json", { ok:true, status:"ALL_SEGMENT_CONFIGURATION_PLANNED", routes:names.map((route,index)=>({route,currentCampaignId:index < 2 ? null : "campaign-"+index})) });
  const uploadPath = writeJson("upload.json", { ok:true,status:"UPLOAD_COMPLETED",uploadFingerprint:"E9157BDC2E0D724F9C0BE0BC49939271BE1FB57B1A6DC4CAD4DCF3C4BD0FD4F4",summary:{uploaded:5654} });
  const masterPath = writeJsonl("master.jsonl", Array.from({length:8578},(_,i)=>({email:"lead-"+i+"@example.com"})));
  const riskyPath = writeJsonl("risky.jsonl", [{email:"risky@example.com"}]);
  const invalidPath = writeJsonl("invalid.jsonl", [{email:"invalid@example.com"}]);
  const replyRoutingPath = writeJson("reply.json", {ok:true,positive:"positive",negative:"no",neutral:"nurture",technical:"technical",outOfOffice:"out_of_office"});
  const campaigns = new Map(names.map((name,index)=>["campaign-"+index,{
    id:"campaign-"+index,status:2,email_list:routeSenders(name),stop_on_reply:true,stop_on_auto_reply:true,allow_risky_contacts:false,disable_bounce_protect:false,
    sequences:[{steps:Array.from({length:4},(_,step)=>({subject:"Subject "+step,body:"Body "+step}))}]
  }]));
  const accounts = senders.map(value=>({email:value,status:1}));
  const service = new Service({rootDir:root,configurationPath,configurationPlanPath,uploadPath,masterPath,riskyPath,invalidPath,replyRoutingPath,outputRoot:path.join(root,"output"),generatedAt:()=>"2026-08-08T00:00:00.000Z",campaignProvider:async id=>campaigns.get(id),accountProvider:async()=>({items:accounts})});

  await test("service is constructable",async()=>assert.ok(service));
  const preview=await service.audit({});
  await test("default mode is plan-only",async()=>assert.strictEqual(preview.mode,"PLAN_ONLY"));
  await test("plan performs no provider reads",async()=>assert.strictEqual(preview.providerReadsAuthorized,false));
  await test("apply requires live flag",async()=>assert.rejects(()=>service.audit({apply:true}),/--live/));
  const report=await service.audit({apply:true,live:true});
  await test("audit completes",async()=>assert.strictEqual(report.status,"OUTBOUND_READINESS_AUDITED"));
  await test("ready state is explicit",async()=>assert.strictEqual(report.readyToLaunch,true));
  await test("ten campaigns are audited",async()=>assert.strictEqual(report.summary.campaignsAudited,10));
  await test("all campaigns pass",async()=>assert.strictEqual(report.summary.campaignsReady,10));
  await test("all campaigns remain paused",async()=>assert.ok(report.routes.every(route=>route.paused)));
  await test("four message steps are required",async()=>assert.ok(report.routes.every(route=>route.messageSteps===4)));
  await test("nine unique senders are present",async()=>assert.strictEqual(report.summary.uniqueSenders,9));
  await test("all provider accounts are healthy",async()=>assert.strictEqual(report.summary.healthyProviderAccounts,9));
  await test("verified lead conservation is preserved",async()=>assert.strictEqual(report.summary.verifiedLeads,8578));
  await test("suppression has no conflicts",async()=>assert.strictEqual(report.suppression.ok,true));
  await test("reply routing is healthy",async()=>assert.strictEqual(report.replyRouting.ok,true));
  await test("provider reads are recorded",async()=>assert.strictEqual(report.providerReadsPerformed,true));
  await test("provider writes remain unauthorized",async()=>assert.strictEqual(report.providerWritesAuthorized,false));
  await test("no emails send",async()=>assert.strictEqual(report.emailsSent,false));
  await test("no campaigns change",async()=>assert.strictEqual(report.campaignsChanged,false));
  await test("no campaigns launch",async()=>assert.strictEqual(report.campaignsLaunched,false));
  await test("readiness fingerprint is recorded",async()=>assert.match(report.readinessFingerprint,/^[A-F0-9]{64}$/));
  await test("evidence artifact exists",async()=>assert.strictEqual(fs.existsSync(report.artifact.filePath),true));
  await test("CLI defaults safely",async()=>assert.deepStrictEqual(parseArguments([]),{apply:false,live:false}));
  await test("CLI parses live audit",async()=>assert.deepStrictEqual(parseArguments(["--apply","--live"]),{apply:true,live:true}));

  campaigns.get("campaign-0").status=1;
  campaigns.get("campaign-0").sequences=[{steps:[{subject:"One",body:"Body"}]}];
  const blocked=await new Service({rootDir:root,configurationPath,configurationPlanPath,uploadPath,masterPath,riskyPath,invalidPath,replyRoutingPath,outputRoot:path.join(root,"blocked"),campaignProvider:async id=>campaigns.get(id),accountProvider:async()=>({items:accounts})}).audit({apply:true,live:true});
  await test("active campaign fails readiness closed",async()=>assert.ok(blocked.routes[0].blockers.includes("CAMPAIGN_NOT_PAUSED")));
  await test("missing follow-ups fail readiness closed",async()=>assert.ok(blocked.routes[0].blockers.includes("FOUR_STEP_SEQUENCE_REQUIRED")));
  await test("blocked audit never authorizes launch",async()=>assert.strictEqual(blocked.campaignsLaunched,false));

  const missingReply=await new Service({rootDir:root,configurationPath,configurationPlanPath,uploadPath,masterPath,riskyPath,invalidPath,replyRoutingPath:path.join(root,"missing.json"),outputRoot:path.join(root,"missing"),campaignProvider:async id=>{const c=campaigns.get(id);return {...c,status:2,sequences:[{steps:Array.from({length:4},(_,i)=>({subject:"S"+i,body:"B"+i}))}]};},accountProvider:async()=>({items:accounts})}).audit({apply:true,live:true});
  await test("missing reply routing is reported",async()=>assert.ok(missingReply.globalBlockers.includes("REPLY_ROUTING_EVIDENCE_REQUIRED")));

  console.log("REVENUE_OUTBOUND_READINESS_AUDIT_TEST_PASS "+passed+"/28");
  fs.rmSync(root,{recursive:true,force:true});
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
