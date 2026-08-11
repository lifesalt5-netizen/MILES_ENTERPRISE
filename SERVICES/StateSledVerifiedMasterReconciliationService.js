"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_instantly_reconciliation_rules.json");

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
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
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
    const v = row?.[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeState(value) {
  return String(value || "").trim().toUpperCase();
}

function dedupeVerified(rows) {
  const byEmail = new Map();
  for (const row of rows) {
    const email = normalizeEmail(first(row, ["discoveredEmail", "email", "Email"]));
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, row);
  }
  return [...byEmail.values()];
}

function flattenCampaignPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.campaigns)) return payload.campaigns;
  return [];
}

function campaignName(campaign) {
  return first(campaign, ["name", "campaign_name", "campaignName", "title"]);
}

function buildExpectedCampaigns(rules, verifiedRows) {
  const counts = {};
  for (const state of rules.wave1States || []) counts[state] = 0;
  for (const row of verifiedRows) {
    const state = normalizeState(first(row, ["state", "State", "NORMALIZED_STATE"]));
    if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state]++;
  }
  return (rules.wave1States || []).map(state => ({
    state,
    expectedName: `${rules.campaignNaming.prefix}${state}`,
    verifiedContacts: counts[state] || 0,
    aliases: rules.campaignNaming.aliases?.[state] || []
  }));
}

function reconcileCampaigns(expected, liveCampaigns, rules) {
  const live = liveCampaigns.map(c => ({ ...c, _normalizedName: normalizeName(campaignName(c)) }));
  const reconciliation = expected.map(item => {
    const acceptable = new Set([item.expectedName, ...(item.aliases || [])].map(normalizeName));
    const match = live.find(c => acceptable.has(c._normalizedName));
    return {
      state: item.state,
      expectedName: item.expectedName,
      verifiedContacts: item.verifiedContacts,
      status: match ? "EXISTS" : "MISSING",
      liveCampaignName: match ? campaignName(match) : "",
      liveCampaignId: match ? first(match, ["id", "campaign_id", "campaignId"]) : ""
    };
  });

  const pipelineNames = new Set((rules.pipelineStateCampaignNames || []).map(normalizeName));
  const pipelineStateCampaigns = live
    .filter(c => pipelineNames.has(c._normalizedName))
    .map(c => ({
      name: campaignName(c),
      id: first(c, ["id", "campaign_id", "campaignId"]),
      status: first(c, ["status", "campaign_status", "campaignStatus"])
    }));

  return { reconciliation, pipelineStateCampaigns };
}

async function readAllVerifiedBatches(rules) {
  const dir = path.join(ROOT, rules.verifiedBatchDir);
  if (!fs.existsSync(dir)) return { files: [], rows: [] };
  const files = fs.readdirSync(dir)
    .filter(name => name.startsWith(rules.verifiedBatchPattern) && /\.csv$/i.test(name))
    .sort()
    .map(name => path.join(dir, name));
  const rows = [];
  for (const file of files) rows.push(...await readCsv(file));
  return { files, rows };
}

async function readLiveInstantlyCampaigns() {
  const connector = require("../CONNECTORS/INSTANTLY/connector");
  const result = await connector.execute({ action: "listCampaigns", payload: { limit: 100 } });
  if (!result?.ok) throw new Error(result?.error || "Instantly campaign inventory failed");
  return flattenCampaignPayload(result.campaigns);
}

async function run() {
  const rules = loadRules();
  const batches = await readAllVerifiedBatches(rules);
  const verified = dedupeVerified(batches.rows);
  const liveCampaigns = await readLiveInstantlyCampaigns();
  const expected = buildExpectedCampaigns(rules, verified);
  const { reconciliation, pipelineStateCampaigns } = reconcileCampaigns(expected, liveCampaigns, rules);

  const outDir = path.join(ROOT, rules.outputDir);
  const masterFile = path.join(outDir, "STATE_SLED_WAVE1_VERIFIED_MASTER.csv");
  const campaignPlanFile = path.join(outDir, "STATE_SLED_INSTANTLY_CAMPAIGN_RECONCILIATION.csv");
  const pipelineAuditFile = path.join(outDir, "STATE_SLED_PIPELINE_STATE_CAMPAIGN_AUDIT.csv");
  const auditFile = path.join(outDir, "STATE_SLED_VERIFIED_MASTER_RECONCILIATION_AUDIT.json");

  writeCsv(masterFile, verified);
  writeCsv(campaignPlanFile, reconciliation);
  writeCsv(pipelineAuditFile, pipelineStateCampaigns);

  const stats = {
    generatedAt: new Date().toISOString(),
    verifiedBatchFiles: batches.files.length,
    verifiedRowsRaw: batches.rows.length,
    verifiedContactsUnique: verified.length,
    liveInstantlyCampaigns: liveCampaigns.length,
    expectedStateCampaigns: expected.length,
    existingStateCampaigns: reconciliation.filter(x => x.status === "EXISTS").length,
    missingStateCampaigns: reconciliation.filter(x => x.status === "MISSING").length,
    pipelineStateCampaignsDetected: pipelineStateCampaigns.length,
    verifiedByState: Object.fromEntries(expected.map(x => [x.state, x.verifiedContacts])),
    safety: rules.safety
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(auditFile, JSON.stringify({ gate: rules.gate, rulesVersion: rules.version, stats, outputs: { masterFile, campaignPlanFile, pipelineAuditFile, auditFile } }, null, 2));

  return {
    ok: true,
    gate: rules.gate,
    rulesVersion: rules.version,
    stats,
    reconciliation,
    pipelineStateCampaigns,
    outputs: { masterFile, campaignPlanFile, pipelineAuditFile, auditFile }
  };
}

module.exports = {
  run,
  dedupeVerified,
  flattenCampaignPayload,
  buildExpectedCampaigns,
  reconcileCampaigns,
  normalizeName
};
