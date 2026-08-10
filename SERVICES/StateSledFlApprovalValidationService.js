"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_fl_approval_validation_rules.json");
const EXECUTION_PACKAGE_FILE = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "EXECUTION_PACKAGE", "STATE_SLED_EXECUTION_PACKAGES.json");
const CAMPAIGN_PLAN_FILE = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "CAMPAIGN_PLAN", "STATE_SLED_CAMPAIGN_CREATION_UPLOAD_PLAN.csv");
const UPLOAD_PLAN_FILE = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "CAMPAIGN_PLAN", "STATE_SLED_VERIFIED_LEAD_UPLOAD_PLAN.csv");
const SEQUENCE_PLAN_FILE = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "CAMPAIGN_PLAN", "STATE_SLED_SEQUENCE_APPROVAL_PLAN.json");
const OUT_DIR = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "APPROVAL_PACKAGE");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCsvRows(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = lines.shift().split(",").map(x => x.replace(/^"|"$/g, ""));
  return lines.map(line => {
    const values = line.match(/("(?:[^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0).map(v => v.replace(/^"|"$/g, "").replace(/""/g, '"'));
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

function boolFalse(value) {
  return value === false || String(value).toLowerCase() === "false";
}

async function run() {
  const rules = loadJson(RULES_FILE);
  const missingInputs = [EXECUTION_PACKAGE_FILE, CAMPAIGN_PLAN_FILE, UPLOAD_PLAN_FILE, SEQUENCE_PLAN_FILE].filter(file => !fs.existsSync(file));
  if (missingInputs.length) throw new Error(`P1.3J missing required inputs: ${missingInputs.join(", ")}`);

  const rawPackages = loadJson(EXECUTION_PACKAGE_FILE);
  const packages = Array.isArray(rawPackages) ? rawPackages : (rawPackages.packages || []);
  const targetPackage = packages.find(p => String(p.state).toUpperCase() === rules.targetState);
  if (!targetPackage) throw new Error(`P1.3J target execution package not found for ${rules.targetState}`);

  const campaignRows = readCsvRows(CAMPAIGN_PLAN_FILE);
  const campaignRow = campaignRows.find(row => String(row.state || row.State || "").toUpperCase() === rules.targetState) || {};
  const uploadRows = readCsvRows(UPLOAD_PLAN_FILE).filter(row => String(row.state || row.State || "").toUpperCase() === rules.targetState);
  const sequencePlan = loadJson(SEQUENCE_PLAN_FILE);

  const checks = {
    campaignNameExact: targetPackage.campaignName === rules.expectedCampaignName,
    campaignMissingOrReady: ["MISSING", "READY_FOR_CREATION_APPROVAL", ""].includes(String(campaignRow.liveCampaignStatus || campaignRow.readiness || "")),
    verifiedLeadThresholdMet: Number(targetPackage.leadUpload?.rowsPrepared || uploadRows.length) >= rules.minimumVerifiedContacts,
    uploadRowCountMatchesPackage: Number(targetPackage.leadUpload?.rowsPrepared || 0) === uploadRows.length,
    senderRequirementMetInPlan: Number(targetPackage.senderAssignment?.minimumHealthySenders || 0) >= rules.minimumHealthySenders,
    dailyInboxCapSafe: Number(targetPackage.senderAssignment?.maximumDailyPerInbox || 9999) <= rules.maximumDailyPerInbox,
    sequenceApprovalRequired: targetPackage.sequence?.requiresApproval === true,
    sequenceStillDraft: String(targetPackage.sequence?.status || "") === rules.requiredSequenceStatus,
    campaignCreationApprovalRequired: targetPackage.campaignCreate?.requiresApproval === true && targetPackage.campaignCreate?.approved === false,
    leadUploadApprovalRequired: targetPackage.leadUpload?.requiresApproval === true && targetPackage.leadUpload?.approved === false,
    activationApprovalRequired: targetPackage.activation?.requiresApproval === true && targetPackage.activation?.approved === false,
    mutationsBlocked: boolFalse(rules.safety.executeInstantlyMutations),
    activationBlocked: boolFalse(rules.safety.activateCampaigns),
    autoApprovalBlocked: boolFalse(rules.safety.autoApprove),
    sequencePlanPresent: !!sequencePlan
  };

  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const readyForApproval = failedChecks.length === 0;

  const approvalPackage = {
    state: rules.targetState,
    campaignName: rules.expectedCampaignName,
    readyForApproval,
    verifiedLeadRows: uploadRows.length,
    senderPolicy: {
      minimumHealthySenders: rules.minimumHealthySenders,
      maximumDailyPerInbox: rules.maximumDailyPerInbox
    },
    sequenceStatus: targetPackage.sequence?.status || "UNKNOWN",
    executionOrder: rules.executionOrder,
    approvalsRequired: rules.requiredApprovalGates,
    checks,
    failedChecks,
    authorizedToExecute: false,
    authorizedToActivate: false
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const packageFile = path.join(OUT_DIR, "STATE_SLED_FL_APPROVAL_PACKAGE.json");
  const auditFile = path.join(OUT_DIR, "STATE_SLED_FL_APPROVAL_VALIDATION_AUDIT.json");
  fs.writeFileSync(packageFile, JSON.stringify(approvalPackage, null, 2));
  fs.writeFileSync(auditFile, JSON.stringify({ gate: rules.gate, generatedAt: new Date().toISOString(), approvalPackage, safety: rules.safety }, null, 2));

  return {
    ok: true,
    gate: rules.gate,
    stats: {
      state: rules.targetState,
      verifiedLeadRows: uploadRows.length,
      validationChecks: Object.keys(checks).length,
      failedChecks: failedChecks.length,
      readyForApproval,
      authorizedToExecute: false,
      authorizedToActivate: false,
      safety: rules.safety
    },
    approvalPackage,
    outputs: { packageFile, auditFile }
  };
}

module.exports = { run };
