"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const K7J_DIR = path.join(ROOT, "DATA", "OUTBOUND", "FEDERAL_ORION_BASELINE_K7J");
const INVENTORY_FILE = path.join(ROOT, "DATA", "OUTBOUND", "SEGMENT_INVENTORY_MASTER.csv");

const SEGMENTS = [
  ["GSA_NO_SALES", "GSA_NO_SALES.csv", 4],
  ["GSA_1_TO_LT3M", "GSA_1_TO_LT3M.csv", 4],
  ["GSA_3_TO_LT10M", "GSA_3_TO_LT10M.csv", 4],
  ["GSA_10M_PLUS", "GSA_10M_PLUS.csv", 4],
  ["GSA_UNKNOWN", "GSA_UNKNOWN.csv", 4],
  ["VA_FSS_NO_SALES", "VA_FSS_NO_SALES.csv", 5],
  ["VA_FSS_1_TO_LT3M", "VA_FSS_1_TO_LT3M.csv", 5],
  ["VA_FSS_3_TO_LT10M", "VA_FSS_3_TO_LT10M.csv", 5],
  ["VA_FSS_10M_PLUS", "VA_FSS_10M_PLUS.csv", 5],
  ["VA_FSS_UNKNOWN", "VA_FSS_UNKNOWN.csv", 5]
];

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function countRows(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

function run() {
  if (!fs.existsSync(K7J_DIR)) {
    throw new Error(`K7J_OUTPUT_DIR_NOT_FOUND: ${K7J_DIR}`);
  }

  const rows = [];
  const missing = [];

  for (const [segmentName, fileName, priority] of SEGMENTS) {
    const sourceFile = path.join(K7J_DIR, fileName);
    const leadCount = countRows(sourceFile);

    if (leadCount === null) {
      missing.push(sourceFile);
      continue;
    }

    rows.push({
      Segment_Name: segmentName,
      Lead_Count: leadCount,
      Verified_Email_Count: 0,
      Campaign_Name: "",
      Campaign_Status: "INVENTORY_ONLY_ACCEPTED_ORION_BASELINE",
      Assigned_Domain: "",
      Assigned_Inboxes: "",
      Source_File: sourceFile,
      Needs_Upload: "false",
      Needs_Enrichment: "true",
      Priority: priority,
      Source_Status: "ACCEPTED_ORION_BASELINE_NOT_FULLY_CURRENT"
    });
  }

  if (missing.length) {
    throw new Error(`K7J_SEGMENT_FILES_MISSING: ${missing.join(" | ")}`);
  }

  const headers = [
    "Segment_Name",
    "Lead_Count",
    "Verified_Email_Count",
    "Campaign_Name",
    "Campaign_Status",
    "Assigned_Domain",
    "Assigned_Inboxes",
    "Source_File",
    "Needs_Upload",
    "Needs_Enrichment",
    "Priority",
    "Source_Status"
  ];

  fs.mkdirSync(path.dirname(INVENTORY_FILE), { recursive: true });
  const text = [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(","))
  ].join("\n");

  fs.writeFileSync(INVENTORY_FILE, text, "utf8");

  const totalLeads = rows.reduce((sum, row) => sum + Number(row.Lead_Count || 0), 0);

  return {
    ok: true,
    gate: "ACCEPTED_ORION_SEGMENT_INVENTORY_REFRESH",
    inventoryFile: INVENTORY_FILE,
    sourceDir: K7J_DIR,
    segmentsWritten: rows.length,
    totalLeads,
    verifiedEmails: 0,
    liveCampaignsMutated: false,
    note: "Accepted K7J GSA/VA membership and revenue tiers only. Email readiness remains a separate downstream concern."
  };
}

module.exports = { run };
