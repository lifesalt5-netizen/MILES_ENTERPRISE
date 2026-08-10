"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_enrichment_queue_rules.json");
const INPUT_FILE = path.join(ROOT, "DATA", "OUTBOUND", "CANONICAL_IDENTITY", "STATE_SLED_WAVE1_CLEAN_FOR_ENRICHMENT.csv");
const OUT_DIR = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "ENRICHMENT_QUEUE");

function firstValue(row, fields = []) {
  for (const field of fields) {
    const value = row[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function numericValue(row, fields = []) {
  for (const field of fields) {
    const n = Number(row[field]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeWebsite(value) {
  let v = String(value || "").trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(file, rows) {
  if (!rows.length) {
    fs.writeFileSync(file, "", "utf8");
    return;
  }
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(","));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
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

function priorityScore(row, rules) {
  const state = firstValue(row, rules.stateFields).toUpperCase();
  const industry = firstValue(row, rules.industryFields).toUpperCase();
  const stateIndex = rules.statePriority.indexOf(state);
  const industryIndex = rules.industryPriority.indexOf(industry);
  const leadScore = numericValue(row, rules.leadScoreFields);
  const market = String(row.Market_Priority || "").toUpperCase();
  const website = normalizeWebsite(firstValue(row, rules.websiteFields));
  const poc = firstValue(row, rules.nameFields);

  let score = leadScore;
  if (market === "TOP_MARKET") score += 30;
  if (stateIndex >= 0) score += Math.max(0, 25 - stateIndex * 3);
  if (industryIndex >= 0) score += Math.max(0, 25 - industryIndex * 3);
  if (website) score += 15;
  if (poc) score += 10;
  return score;
}

async function run(options = {}) {
  const rulesFile = options.rulesFile || RULES_FILE;
  const inputFile = options.inputFile || INPUT_FILE;
  const outDir = options.outDir || OUT_DIR;

  if (!fs.existsSync(rulesFile)) throw new Error(`Rules file not found: ${rulesFile}`);
  if (!fs.existsSync(inputFile)) throw new Error(`Input file not found: ${inputFile}`);

  const rules = JSON.parse(fs.readFileSync(rulesFile, "utf8"));
  const rows = await readCsv(inputFile);

  const enrichment = [];
  const verification = [];
  const researchHold = [];

  for (const row of rows) {
    const email = firstValue(row, rules.emailFields).toLowerCase();
    const websiteRaw = firstValue(row, rules.websiteFields);
    const domain = normalizeWebsite(websiteRaw);
    const score = priorityScore(row, rules);
    const state = firstValue(row, rules.stateFields).toUpperCase();
    const industry = firstValue(row, rules.industryFields).toUpperCase();

    const common = {
      ...row,
      p1_3d_priority_score: score,
      p1_3d_state: state,
      p1_3d_industry: industry,
      p1_3d_domain: domain,
      p1_3d_generated_at: new Date().toISOString()
    };

    if (email && validEmail(email)) {
      verification.push({
        ...common,
        p1_3d_queue: "VERIFY_EXISTING_EMAIL",
        p1_3d_email_candidate: email,
        p1_3d_verification_status: "PENDING"
      });
      continue;
    }

    if (domain) {
      enrichment.push({
        ...common,
        p1_3d_queue: "EMAIL_DISCOVERY_REQUIRED",
        p1_3d_email_candidate: "",
        p1_3d_enrichment_status: "PENDING"
      });
      continue;
    }

    researchHold.push({
      ...common,
      p1_3d_queue: "WEBSITE_RESEARCH_REQUIRED",
      p1_3d_email_candidate: "",
      p1_3d_research_status: "PENDING"
    });
  }

  const sorter = (a, b) => Number(b.p1_3d_priority_score || 0) - Number(a.p1_3d_priority_score || 0);
  enrichment.sort(sorter);
  verification.sort(sorter);
  researchHold.sort(sorter);

  enrichment.forEach((row, index) => {
    row.p1_3d_batch = Math.floor(index / rules.batchSize) + 1;
    row.p1_3d_batch_position = (index % rules.batchSize) + 1;
  });
  verification.forEach((row, index) => {
    row.p1_3d_batch = Math.floor(index / rules.batchSize) + 1;
    row.p1_3d_batch_position = (index % rules.batchSize) + 1;
  });
  researchHold.forEach((row, index) => {
    row.p1_3d_batch = Math.floor(index / rules.batchSize) + 1;
    row.p1_3d_batch_position = (index % rules.batchSize) + 1;
  });

  fs.mkdirSync(outDir, { recursive: true });

  const enrichmentFile = path.join(outDir, "STATE_SLED_WAVE1_EMAIL_DISCOVERY_QUEUE.csv");
  const verificationFile = path.join(outDir, "STATE_SLED_WAVE1_EMAIL_VERIFICATION_QUEUE.csv");
  const researchHoldFile = path.join(outDir, "STATE_SLED_WAVE1_WEBSITE_RESEARCH_HOLD.csv");
  const auditFile = path.join(outDir, "STATE_SLED_WAVE1_ENRICHMENT_QUEUE_AUDIT.json");

  writeCsv(enrichmentFile, enrichment);
  writeCsv(verificationFile, verification);
  writeCsv(researchHoldFile, researchHold);

  const stats = {
    source: inputFile,
    generatedAt: new Date().toISOString(),
    totalCleanWave1: rows.length,
    emailDiscoveryRequired: enrichment.length,
    existingEmailVerificationRequired: verification.length,
    websiteResearchRequired: researchHold.length,
    discoveryBatches: Math.ceil(enrichment.length / rules.batchSize),
    verificationBatches: Math.ceil(verification.length / rules.batchSize),
    researchBatches: Math.ceil(researchHold.length / rules.batchSize),
    batchSize: rules.batchSize,
    topDiscoverySample: enrichment.slice(0, 10).map(row => ({
      uei: row.UEI || row.uei || "",
      legalName: row.Legal_Name || row.legal_name || "",
      state: row.p1_3d_state,
      industry: row.p1_3d_industry,
      domain: row.p1_3d_domain,
      score: row.p1_3d_priority_score,
      batch: row.p1_3d_batch
    })),
    safety: rules.safety
  };

  fs.writeFileSync(auditFile, JSON.stringify(stats, null, 2), "utf8");

  return {
    ok: true,
    gate: rules.gate,
    rulesVersion: rules.version,
    outputs: { enrichmentFile, verificationFile, researchHoldFile, auditFile },
    stats
  };
}

module.exports = { run, validEmail, normalizeWebsite, priorityScore };
