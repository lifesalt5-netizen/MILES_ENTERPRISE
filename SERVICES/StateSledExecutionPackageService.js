"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_execution_package_rules.json");

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv())
      .on("data", row => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

async function run() {
  const rules = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
  const campaignPlanFile = path.join(ROOT, rules.campaignPlanFile);
  const uploadPlanFile = path.join(ROOT, rules.uploadPlanFile);

  if (!fs.existsSync(campaignPlanFile)) throw new Error(`Campaign plan missing: ${campaignPlanFile}`);
  if (!fs.existsSync(uploadPlanFile)) throw new Error(`Upload plan missing: ${uploadPlanFile}`);

  const campaignRows = await readCsv(campaignPlanFile);
  const uploadRows = await readCsv(uploadPlanFile);

  const ready = campaignRows.filter(row =>
    rules.allowedStates.includes(String(row.state || "").toUpperCase()) &&
    String(row.readiness || "") === rules.requirements.campaignCreationReadiness
  );

  const packages = ready.map(row => {
    const state = String(row.state || "").toUpperCase();
    const campaignName = row.campaignName || `STATE SLED - ${state}`;
    const leads = uploadRows.filter(x => String(x.state || "").toUpperCase() === state);

    return {
      state,
      campaignName,
      campaignCreate: {
        action: "CREATE_CAMPAIGN",
        provider: "Instantly",
        approved: false,
        requiresApproval: !!rules.approvals.campaignCreation
      },
      leadUpload: {
        action: "UPLOAD_VERIFIED_LEADS",
        provider: "Instantly",
        approved: false,
        requiresApproval: !!rules.approvals.leadUpload,
        rowsPrepared: leads.length
      },
      senderAssignment: {
        required: true,
        minimumHealthySenders: Number(row.minimumHealthySenders || rules.requirements.minimumHealthySenders),
        maximumDailyPerInbox: Number(row.maximumDailyPerInbox || rules.requirements.maximumDailyPerInbox)
      },
      sequence: {
        status: row.sequenceStatus || rules.requirements.sequenceStatusRequired,
        requiresApproval: !!rules.approvals.sequenceCopy
      },
      activation: {
        action: "ACTIVATE_CAMPAIGN",
        approved: false,
        requiresApproval: !!rules.approvals.activation
      }
    };
  });

  const outDir = path.join(ROOT, rules.outputDir);
  const packageFile = path.join(outDir, "STATE_SLED_EXECUTION_PACKAGES.json");
  const auditFile = path.join(outDir, "STATE_SLED_EXECUTION_PACKAGE_AUDIT.json");

  const stats = {
    generatedAt: new Date().toISOString(),
    campaignRows: campaignRows.length,
    uploadRows: uploadRows.length,
    executionPackagesPrepared: packages.length,
    statesPrepared: packages.map(p => p.state),
    totalLeadRowsPrepared: packages.reduce((n, p) => n + p.leadUpload.rowsPrepared, 0),
    allMutationsApprovalGated: packages.every(p =>
      p.campaignCreate.requiresApproval &&
      p.leadUpload.requiresApproval &&
      p.sequence.requiresApproval &&
      p.activation.requiresApproval
    ),
    safety: rules.safety
  };

  writeJson(packageFile, { gate: rules.gate, rulesVersion: rules.version, packages });
  writeJson(auditFile, { gate: rules.gate, rulesVersion: rules.version, stats, outputs: { packageFile, auditFile } });

  return {
    ok: true,
    gate: rules.gate,
    rulesVersion: rules.version,
    stats,
    packages,
    outputs: { packageFile, auditFile }
  };
}

module.exports = { run };
