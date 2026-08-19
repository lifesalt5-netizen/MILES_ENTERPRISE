"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_campaign_plan_rules.json");

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!rows.length) {
    fs.writeFileSync(file, "", "utf8");
    return;
  }
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(headers.map(h => csvEscape(row[h])).join(","));
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

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

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function renderCampaignName(template, state) {
  return String(template || "STATE SLED - {{STATE}}").replace(/{{STATE}}/g, state);
}

async function run() {
  const rules = loadRules();
  const verifiedMaster = path.join(ROOT, rules.verifiedMaster);
  const reconciliationFile = path.join(ROOT, rules.reconciliationFile);

  if (!fs.existsSync(verifiedMaster)) throw new Error(`Verified master not found: ${verifiedMaster}`);
  if (!fs.existsSync(reconciliationFile)) throw new Error(`Reconciliation file not found: ${reconciliationFile}`);

  const verifiedRows = await readCsv(verifiedMaster);
  const reconciliationRows = await readCsv(reconciliationFile);

  const deduped = [];
  const seen = new Set();
  for (const row of verifiedRows) {
    const email = normalizeEmail(first(row, ["discoveredEmail", "email", "Email"]));
    if (!email || seen.has(email)) continue;
    seen.add(email);
    deduped.push(row);
  }

  const reconByState = new Map();
  for (const row of reconciliationRows) {
    const state = first(row, ["state", "State"]);
    if (state) reconByState.set(state.toUpperCase(), row);
  }

  const plan = [];
  const uploadRows = [];

  for (const state of rules.states || []) {
    const contacts = deduped.filter(row => first(row, ["state", "State"]).toUpperCase() === state);
    const reconciliation = reconByState.get(state) || {};
    const expectedName = first(reconciliation, ["expectedName"]) || renderCampaignName(rules.campaignNameTemplate, state);
    const liveStatus = String(first(reconciliation, ["status"]) || "MISSING").toUpperCase();
    const liveCampaignId = first(reconciliation, ["liveCampaignId"]);
    const minimum = Number(rules.minimumVerifiedContactsToPrepare || 1);

    let readiness = "WAIT_FOR_VERIFIED_CONTACTS";
    if (contacts.length >= minimum && liveStatus === "MISSING") readiness = "READY_FOR_CREATION_APPROVAL";
    if (contacts.length >= minimum && liveStatus !== "MISSING") readiness = "READY_FOR_UPLOAD_APPROVAL";

    const batchSize = Number(rules.leadBatchSize || 500);
    contacts.forEach((row, index) => {
      uploadRows.push({
        state,
        campaignName: expectedName,
        liveCampaignId,
        uploadBatch: Math.floor(index / batchSize) + 1,
        email: normalizeEmail(first(row, ["discoveredEmail", "email", "Email"])),
        uei: first(row, ["uei", "UEI"]),
        legalName: first(row, ["legalName", "Legal_Name", "legal_name"]),
        domain: first(row, ["domain", "Domain"]),
        verificationDisposition: first(row, ["verificationDisposition"]),
        approvedForUpload: false
      });
    });

    plan.push({
      state,
      campaignName: expectedName,
      liveCampaignStatus: liveStatus,
      liveCampaignId,
      verifiedContacts: contacts.length,
      minimumVerifiedContactsToPrepare: minimum,
      readiness,
      leadUploadBatches: Math.ceil(contacts.length / batchSize),
      senderAssignmentRequired: !!rules.senderPolicy?.required,
      minimumHealthySenders: Number(rules.senderPolicy?.minimumHealthySenders || 1),
      maximumDailyPerInbox: Number(rules.senderPolicy?.maximumDailyPerInbox || 25),
      sequenceStatus: rules.sequence?.status || "DRAFT_FOR_APPROVAL",
      campaignCreationRequiresApproval: !!rules.approval?.campaignCreationRequiresApproval,
      leadUploadRequiresApproval: !!rules.approval?.leadUploadRequiresApproval,
      activationRequiresApproval: !!rules.approval?.activationRequiresApproval
    });
  }

  const outDir = path.join(ROOT, rules.outputDir);
  const planFile = path.join(outDir, "STATE_SLED_CAMPAIGN_CREATION_UPLOAD_PLAN.csv");
  const uploadFile = path.join(outDir, "STATE_SLED_VERIFIED_LEAD_UPLOAD_PLAN.csv");
  const sequenceFile = path.join(outDir, "STATE_SLED_SEQUENCE_APPROVAL_PLAN.json");
  const auditFile = path.join(outDir, "STATE_SLED_CAMPAIGN_PLAN_AUDIT.json");

  writeCsv(planFile, plan);
  writeCsv(uploadFile, uploadRows);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(sequenceFile, JSON.stringify(rules.sequence, null, 2), "utf8");

  const stats = {
    generatedAt: new Date().toISOString(),
    verifiedContactsUnique: deduped.length,
    statesPlanned: plan.length,
    readyForCreationApproval: plan.filter(x => x.readiness === "READY_FOR_CREATION_APPROVAL").length,
    readyForUploadApproval: plan.filter(x => x.readiness === "READY_FOR_UPLOAD_APPROVAL").length,
    waitingForVerifiedContacts: plan.filter(x => x.readiness === "WAIT_FOR_VERIFIED_CONTACTS").length,
    uploadRowsPrepared: uploadRows.length,
    uploadBatchesPrepared: plan.reduce((n, x) => n + x.leadUploadBatches, 0),
    byState: Object.fromEntries(plan.map(x => [x.state, { verifiedContacts: x.verifiedContacts, readiness: x.readiness }])),
    safety: rules.safety
  };

  fs.writeFileSync(auditFile, JSON.stringify({ gate: rules.gate, rulesVersion: rules.version, stats, plan, outputs: { planFile, uploadFile, sequenceFile, auditFile } }, null, 2), "utf8");

  return { ok: true, gate: rules.gate, rulesVersion: rules.version, stats, plan, outputs: { planFile, uploadFile, sequenceFile, auditFile } };
}

module.exports = { run, normalizeEmail, renderCampaignName };
