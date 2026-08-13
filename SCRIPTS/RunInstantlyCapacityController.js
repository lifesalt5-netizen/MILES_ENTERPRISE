"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const LIMIT = Number(process.env.INSTANTLY_CONTACT_LIMIT || 25000);
const TARGET = Number(process.env.P2GC_INSTANTLY_TARGET_CONTACTS || 24900);
const MIN_FLOOR = Number(process.env.P2GC_INSTANTLY_MIN_CONTACTS || 24500);

const RECON = path.join(
  ROOT,
  "DATA","OUTBOUND","INSTANTLY_MASTER_RECONCILIATION",
  "MASTER_INSTANTLY_RECONCILIATION_LATEST.json"
);

const RECLAIM = path.join(
  ROOT,
  "DATA","OUTBOUND","CAPACITY_RECLAMATION",
  "INSTANTLY_CAPACITY_RECLAMATION_CANDIDATES_LATEST.csv"
);

const OUTDIR = path.join(
  ROOT,
  "DATA","OUTBOUND","CAPACITY_CONTROLLER"
);

const OUT = path.join(
  OUTDIR,
  "INSTANTLY_CAPACITY_CONTROLLER_LATEST.json"
);

function countCsvRows(file){
  if(!fs.existsSync(file)) return 0;
  const text = fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"").trim();
  if(!text) return 0;
  const lines = text.split(/\r?\n/);
  return Math.max(0, lines.length - 1);
}

function main(){
  if(!fs.existsSync(RECON)){
    throw new Error(`Missing reconciliation: ${RECON}`);
  }

  const recon = JSON.parse(fs.readFileSync(RECON,"utf8"));
  // The reconciliation writer persists the master payload directly, while
  // some callers wrap it as { master }. Support both shapes canonically.
  const master = recon?.master && typeof recon.master === "object"
    ? recon.master
    : recon;

  const observed = Number(
    master?.totals?.leadsObservedAcrossCampaignMemberships || 0
  );

  const activeCampaigns = Number(
    master?.byStatus?.ACTIVE || 0
  );

  const draftCampaigns = Number(
    master?.byStatus?.DRAFT || 0
  );

  const replies = Number(
    master?.totals?.replies || 0
  );

  if(observed <= 0){
    throw new Error("CAPACITY_CONTROLLER_RECONCILIATION_COUNT_INVALID");
  }

  const headroom = Math.max(0, LIMIT - observed);
  const refillToTarget = Math.max(0, TARGET - observed);
  const reclaimCandidatesObserved = countCsvRows(RECLAIM);

  let decision = "HOLD";
  let nextAction = "NO_CAPACITY_ACTION_REQUIRED";

  if(observed > LIMIT){
    decision = "OVER_LIMIT";
    nextAction = "STOP_AND_RECONCILE_CONTACT_COUNT";
  } else if(observed < MIN_FLOOR){
    decision = "REFILL_PRIORITY_QUEUE";
    nextAction = `REFILL_UP_TO_${TARGET}`;
  } else if(observed < TARGET){
    decision = "TOP_OFF_PRIORITY_QUEUE";
    nextAction = `REFILL_${refillToTarget}_VERIFIED_GOVERNED_CONTACTS`;
  } else if(headroom < 100){
    decision = "PREPARE_RECLAIM_BUFFER";
    nextAction = "PLAN_SAFE_RECLAIM_TO_RESTORE_100_PLUS_HEADROOM";
  }

  const report = {
    ok:true,
    gate:"INSTANTLY_CAPACITY_CONTROLLER_READ_ONLY",
    generatedAt:new Date().toISOString(),
    mode:"READ_ONLY",
    policy:{
      contactLimit:LIMIT,
      targetContacts:TARGET,
      minimumFloor:MIN_FLOOR,
      desiredHeadroom:LIMIT-TARGET,
      oneEmailOneAcquisitionCampaign:true,
      protectReplies:true,
      protectPipeline:true,
      protectNurture:true,
      protectSuppression:true,
      protectStateSled:true,
      priority:[
        "EXPIRED_EVERYTHING",
        "EXPIRING_6M",
        "EXPIRING_12M",
        "GSA",
        "VA_FSS",
        "SAM",
        "CERTIFICATIONS",
        "SBS"
      ]
    },
    current:{
      observedContacts:observed,
      headroom,
      activeCampaigns,
      draftCampaigns,
      replies,
      reclaimCandidatesObserved
    },
    plan:{
      decision,
      refillToTarget,
      nextAction
    },
    safety:{
      deletes:false,
      uploads:false,
      activations:false,
      campaignMutations:false,
      protectedInboxTouched:false,
      stateVirginiaSledTouched:false
    }
  };

  fs.mkdirSync(OUTDIR,{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));
}

try{
  main();
}catch(err){
  console.error(err.stack||err);
  process.exitCode=1;
}
