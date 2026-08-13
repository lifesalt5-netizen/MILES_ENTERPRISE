"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const net = require("net");

const ROOT = process.env.MILES_ROOT || process.cwd();
const instantly = require("../CONNECTORS/INSTANTLY/instantly");

const governedDir = path.join(ROOT,"DATA","OUTBOUND","GOVERNED_LEAD_REPOSITORY");
const finishManifest = path.join(ROOT,"DATA","OUTBOUND","PRODUCTION_FINISH","P2GC_CAMPAIGN_CONFIGURATION_FINISH.json");
const vaGate = path.join(ROOT,"DATA","OUTBOUND","FEDERAL_VA_FSS_GOVERNED","FEDERAL_VA_FSS_READINESS_GATE_LATEST.json");
const masterGoverned = path.join(governedDir,"MASTER_GOVERNED_VERIFIED_ROUTING.csv");
const segInventory = path.join(governedDir,"VERIFIED_SEGMENT_INVENTORY.csv");
const refreshRegistry = path.join(governedDir,"MONTHLY_REFRESH_REGISTRY.json");
const governanceManifest = path.join(governedDir,"OUTBOUND_GOVERNANCE_MANIFEST.json");

function exists(file){ return fs.existsSync(file); }
function readJson(file){ return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"")); }
function lineCount(file){ return fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean).length - 1; }
function checkPort(port){
  return new Promise(resolve => {
    const socket = net.createConnection({host:"127.0.0.1",port});
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    socket.setTimeout(2000);
    socket.once("connect",()=>finish(true));
    socket.once("error",()=>finish(false));
    socket.once("timeout",()=>finish(false));
  });
}

async function main(){
  const checks = {};
  checks.port3000 = await checkPort(3000);
  checks.port8787 = await checkPort(8787);

  const health = await instantly.healthCheck();
  checks.instantlyHealthy = health?.ok === true && health.campaignsReachable === true && health.accountsReachable === true;

  checks.governedMasterExists = exists(masterGoverned);
  checks.segmentInventoryExists = exists(segInventory);
  checks.refreshRegistryExists = exists(refreshRegistry);
  checks.governanceManifestExists = exists(governanceManifest);
  checks.configurationFinishExists = exists(finishManifest);
  checks.vaGateExists = exists(vaGate);

  let governedContacts = null;
  if (checks.governedMasterExists) governedContacts = lineCount(masterGoverned);
  checks.governedContactCountExpected = governedContacts === 2585;

  let governance = null;
  if (checks.governanceManifestExists) governance = readJson(governanceManifest);
  checks.oneCompanyOneCampaign = governance?.oneCompanyOneActiveCampaign === true;
  checks.oneEmailOneCampaign = governance?.oneEmailOneActiveCampaign === true;
  const protectedInboxes = governance?.inboxPolicy?.protectedInboxes || [];
  checks.protectedInboxPolicy = protectedInboxes.includes("kevin@pathways2gc.com") && protectedInboxes.includes("info@pathways2gc.com");

  let finish = null;
  if (checks.configurationFinishExists) finish = readJson(finishManifest);
  checks.configurationFinishPassed = finish?.ok === true && Number(finish?.configuredCampaigns) === 5 && Array.isArray(finish?.failures) && finish.failures.length === 0;

  const cfg = instantly.getConfiguration();
  checks.liveWritesCurrentlyOff = cfg.liveMutationsEnabled !== true;

  const required = Object.entries(checks).filter(([k]) => !["vaGateExists"].includes(k));
  const failed = required.filter(([,v]) => v !== true).map(([k]) => k);

  const report = {
    ok: failed.length === 0,
    gate: "P2GC_AUTONOMOUS_DIGITAL_COO_FINAL_READINESS_GATE",
    generatedAt: new Date().toISOString(),
    checks,
    governedContacts,
    instantlyHealth: {
      ok: health?.ok === true,
      campaignsReachable: health?.campaignsReachable === true,
      accountsReachable: health?.accountsReachable === true,
      dryRun: health?.dryRun,
      mutationsAllowed: health?.mutationsAllowed
    },
    failedChecks: failed,
    safety: {
      readOnly: true,
      leadsUploaded: false,
      campaignsActivated: false,
      emailsSent: false,
      campaignsDeleted: false
    },
    decision: failed.length === 0 ? "READY_FOR_CONTROLLED_WRITE_ENABLEMENT" : "NOT_READY",
    nextAction: failed.length === 0 ? "ENABLE_CONTROLLED_WRITES_AND_RUN_GOVERNED_ACTIVATION" : "REPAIR_ONLY_FAILED_CHECKS"
  };

  const outDir = path.join(ROOT,"DATA","OUTBOUND","PRODUCTION_FINISH");
  fs.mkdirSync(outDir,{recursive:true});
  const outFile = path.join(outDir,"P2GC_AUTONOMOUS_COO_FINAL_GATE.json");
  fs.writeFileSync(outFile,JSON.stringify(report,null,2),"utf8");
  report.outputFile = outFile;
  console.log(JSON.stringify(report,null,2));
  if (!report.ok) process.exitCode = 2;
}

main().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
