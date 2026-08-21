"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueSegmentConfigurationApplyService");
const { inspectCampaignSchedule } = require("../SERVICES/revenue/OutboundSendingGovernance");
const { parseArguments } = require("../SCRIPTS/ApplyRevenueSegmentConfiguration");

let passed = 0;
async function test(name, action) { await action(); passed += 1; console.log("[PASS] " + name); }

(async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-segment-apply-"));
  const planPath = path.join(root, "plan.json");
  const outputRoot = path.join(root, "output");
  const routes = [
    ["Expiring GSA 12 Months", 4659, null, []],
    ["Expiring VA 12 Months", 28, null, []],
    ["GSA", 714, "c-gsa", ["contacts@pathwaysgsa.com", "info@pathwaysgsa.com", "kevin@pathwaysgsa.com"]],
    ["VA", 108, "c-va", ["cora@pathwaysgovcon.com", "evan@pathwaysgovcon.com", "maya@pathwaysgovcon.com", "silvia@pathwaysgovcon.com", "victoria@pathwaysgovcon.com"]],
    ["8(a)", 45, "c-8a", []], ["HUBZone", 83, "c-hub", []], ["SDVOSB", 1766, "c-sd", []],
    ["VOSB", 336, "c-vo", []], ["WOSB", 643, "c-wo", []], ["SBS", 194, "c-sbs", ["kevin@pathwaysgov.com"]],
    ["Unclassified", 2, null, []]
  ].map(([route, verifiedLeads, currentCampaignId, existingInboxes]) => ({ route, verifiedLeads, currentCampaignId, existingInboxes, proposedCampaignName: route + " - Verified" }));
  fs.writeFileSync(planPath, JSON.stringify({
    ok:true, status:"ALL_SEGMENT_CONFIGURATION_PLANNED", configurationFingerprint:"A".repeat(64),
    summary:{verifiedLeads:8578,uniqueEmails:8578,unclassifiedLeads:2}, conservation:{ok:true}, globalDeduplication:{ok:true}, routes
  }), "utf8");

  const created=[], updated=[], paused=[];
  const service=new Service({
    rootDir:root,planPath,outputRoot,outputPath:path.join(outputRoot,"manifest.json"),generatedAt:()=>"2026-08-08T00:00:00.000Z",
    createProvider:async payload=>{created.push(payload);return{id:"created-"+created.length};},
    updateProvider:async(id,payload)=>{updated.push({id,payload});return{id,...payload};},
    pauseProvider:async id=>{paused.push(id);return{id,status:1};}
  });
  const auth="AUTHORIZE_GATE_14_SEGMENT_CONFIGURATION_2_CAMPAIGNS_9_INBOXES_NO_UPLOAD_NO_LAUNCH";

  await test("service is constructable",async()=>assert.ok(service));
  const preview=await service.apply({});
  await test("default mode is plan-only",async()=>assert.strictEqual(preview.mode,"PLAN_ONLY"));
  await test("plan performs no provider writes",async()=>assert.strictEqual(created.length+updated.length+paused.length,0));
  await test("apply requires live flag",async()=>assert.rejects(()=>service.apply({apply:true,authorization:auth}),/--live/));
  await test("wrong authorization fails closed",async()=>assert.rejects(()=>service.apply({apply:true,live:true,authorization:"WRONG"}),/Exact CEO/));

  const report=await service.apply({apply:true,live:true,authorization:auth});
  await test("configuration completes",async()=>assert.strictEqual(report.status,"SEGMENT_CONFIGURATION_COMPLETED"));
  await test("exactly two campaigns are created",async()=>assert.strictEqual(created.length,2));
  await test("created campaigns are the expiring routes",async()=>assert.deepStrictEqual(created.map(item=>item.name),["Expiring GSA 12 Months - Verified","Expiring VA 12 Months - Verified"]));
  await test("created campaigns have zero daily limit until activation",async()=>assert.ok(created.every(item=>item.daily_limit===0&&item.daily_max_leads===0)));
  await test("created campaigns use America New York",async()=>assert.ok(created.every(item=>item.campaign_schedule.schedules[0].timezone==="America/New_York")));
  await test("created campaigns use 08-18 weekday governance",async()=>assert.ok(created.every(item=>inspectCampaignSchedule(item).compliant)));
  await test("all ten classified campaigns are paused",async()=>assert.strictEqual(paused.length,10));
  await test("all ten routes receive configuration",async()=>assert.strictEqual(updated.length,10));
  await test("all updates carry canonical send window",async()=>assert.ok(updated.every(item=>inspectCampaignSchedule(item.payload).compliant)));
  await test("GSA routes use GSA inboxes",async()=>assert.ok(updated.find(item=>item.id==="c-gsa").payload.email_list.every(value=>value.endsWith("@pathwaysgsa.com"))));
  await test("VA route uses GovCon inboxes",async()=>assert.ok(updated.find(item=>item.id==="c-va").payload.email_list.every(value=>value.endsWith("@pathwaysgovcon.com"))));
  await test("certification routes use GovCon inboxes",async()=>assert.ok(updated.find(item=>item.id==="c-sd").payload.email_list.every(value=>value.endsWith("@pathwaysgovcon.com"))));
  await test("SBS uses its dedicated inbox",async()=>assert.deepStrictEqual(updated.find(item=>item.id==="c-sbs").payload.email_list,["kevin@pathwaysgov.com"]));
  await test("nine unique inboxes are assigned",async()=>assert.strictEqual(report.summary.uniqueInboxesAssigned,9));
  await test("all routes record send-window configuration",async()=>assert.strictEqual(report.summary.routesWithCanonicalSendWindow,10));
  await test("8576 classified leads are covered",async()=>assert.strictEqual(report.summary.verifiedLeadsCovered,8576));
  await test("two unclassified leads remain held",async()=>assert.strictEqual(report.summary.unclassifiedHeld,2));
  await test("provider write scope includes canonical send window",async()=>assert.strictEqual(report.providerWriteScope,"CREATE_2_CAMPAIGNS_PAUSE_10_CAMPAIGNS_ASSIGN_9_INBOXES_AND_CANONICAL_SEND_WINDOW"));
  await test("no leads upload",async()=>assert.strictEqual(report.leadsUploaded,0));
  await test("no emails send",async()=>assert.strictEqual(report.emailsSent,false));
  await test("no campaigns launch",async()=>assert.strictEqual(report.campaignsLaunched,false));
  await test("deduplication is preserved",async()=>assert.strictEqual(report.globalDeduplicationPreserved,true));
  await test("progress evidence exists",async()=>assert.strictEqual(fs.existsSync(service.progressPath),true));
  await test("manifest exists",async()=>assert.strictEqual(fs.existsSync(report.artifact.filePath),true));
  await test("manifest hash is recorded",async()=>assert.match(report.artifact.sha256,/^[A-F0-9]{64}$/));
  await test("fingerprint is recorded",async()=>assert.match(report.configurationApplyFingerprint,/^[A-F0-9]{64}$/));

  const second=await service.apply({apply:true,live:true,authorization:auth});
  await test("rerun is idempotent",async()=>assert.strictEqual(second.status,"SEGMENT_CONFIGURATION_COMPLETED"));
  await test("rerun creates no campaigns",async()=>assert.strictEqual(created.length,2));
  await test("rerun performs no extra pauses",async()=>assert.strictEqual(paused.length,10));
  await test("rerun performs no extra updates",async()=>assert.strictEqual(updated.length,10));
  await test("CLI defaults safely",async()=>assert.deepStrictEqual(parseArguments([]),{apply:false,live:false,authorization:null}));
  await test("CLI parses authorization",async()=>assert.deepStrictEqual(parseArguments(["--apply","--live","--authorization="+auth]),{apply:true,live:true,authorization:auth}));

  const dry=new Service({rootDir:root,planPath,outputRoot:path.join(root,"dry"),createProvider:async()=>({dryRun:true,mutationExecuted:false}),updateProvider:async()=>({id:"x"}),pauseProvider:async()=>({id:"x"})});
  await test("dry-run mutation fails closed",async()=>assert.rejects(()=>dry.apply({apply:true,live:true,authorization:auth}),/did not confirm/));

  console.log("REVENUE_SEGMENT_CONFIGURATION_APPLY_TEST_PASS "+passed+"/38");
  fs.rmSync(root,{recursive:true,force:true});
})().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
