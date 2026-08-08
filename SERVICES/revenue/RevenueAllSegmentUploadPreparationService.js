"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }
function csv(value) { const text = String(value == null ? "" : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }

const EXPECTED = Object.freeze({
  "Expiring GSA 12 Months": 2807,
  "Expiring VA 12 Months": 28,
  "GSA": 0,
  "VA": 108,
  "8(a)": 38,
  "HUBZone": 78,
  "SDVOSB": 1674,
  "VOSB": 317,
  "WOSB": 604,
  "SBS": 0
});

class RevenueAllSegmentUploadPreparationService {
  constructor(options = {}) {
    this.service = "REVENUE_ALL_SEGMENT_UPLOAD_PREPARATION";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.auditPath = options.auditPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "global_instantly_duplicate_audit", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_upload_preparation");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "all_segment_upload.csv");
    this.manifestPath = options.manifestPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  preview() {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      expectedUploadCount: 5654, providerReadsAuthorized: false, providerWritesAuthorized: false,
      leadsUploaded: 0, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Gate 15 manifest is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
      else field += char;
    }
    if (quoted) throw new Error("Upload delta contains an unterminated CSV field.");
    if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
    if (!rows.length) throw new Error("Upload delta CSV is empty.");
    const header = rows.shift().map(normalize);
    if (header.join(",") !== "email,route,campaign_id") throw new Error("Upload delta header is invalid.");
    return rows.filter(values => values.some(value => String(value).trim())).map(values => {
      if (values.length !== 3) throw new Error("Upload delta row has an invalid column count.");
      return { email: normalize(values[0]), route: String(values[1] || "").trim(), campaignId: String(values[2] || "").trim() };
    });
  }

  prepare(input = {}) {
    if (input.apply !== true) return this.preview();

    const audit = this.loadJson(this.auditPath);
    if (audit.ok !== true || audit.status !== "GLOBAL_DUPLICATE_AUDIT_COMPLETED" || audit.conservation?.ok !== true) throw new Error("Gate 15 global duplicate audit is unhealthy.");
    if (audit.auditFingerprint !== "8326CCCE56DF9F1F4EEA838007BE00DCFC56C4EDBD8A81EB420FA174DF0A79CB") throw new Error("Gate 15 audit fingerprint changed.");
    const summary = audit.summary || {};
    if (Number(summary.classifiedCandidates) !== 8576 || Number(summary.alreadyPresentGlobally) !== 2922 || Number(summary.uploadDelta) !== 5654 || Number(summary.unclassifiedHeld) !== 2) throw new Error("Gate 15 totals changed.");
    if (audit.providerWritesAuthorized !== false || Number(audit.leadsUploaded) !== 0 || audit.emailsSent !== false || audit.campaignsLaunched !== false) throw new Error("Gate 15 authority boundary is invalid.");
    if (!Array.isArray(audit.routes) || audit.routes.length !== 10) throw new Error("Gate 15 must contain ten route inventories.");

    const records = [];
    const routeResults = [];
    const seenRoutes = new Set();
    for (const route of audit.routes) {
      const name = String(route.route || "").trim();
      if (!Object.prototype.hasOwnProperty.call(EXPECTED, name) || seenRoutes.has(name)) throw new Error("Unexpected or duplicate Gate 15 route: " + name);
      seenRoutes.add(name);
      const expectedCount = EXPECTED[name];
      if (Number(route.uploadDelta) !== expectedCount) throw new Error(name + " upload count changed.");
      if (!route.campaignId) throw new Error(name + " campaign ID is missing.");
      const artifact = route.artifacts?.uploadDelta;
      if (!artifact?.filePath || !fs.existsSync(artifact.filePath)) throw new Error(name + " upload delta artifact is missing.");
      const bytes = fs.readFileSync(artifact.filePath);
      if (sha256(bytes) !== artifact.sha256) throw new Error(name + " upload delta hash mismatch.");
      const rows = this.parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      if (rows.length !== expectedCount || Number(artifact.records) !== expectedCount) throw new Error(name + " upload delta record count mismatch.");
      for (const row of rows) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error("Invalid email in " + name + " delta.");
        if (row.route !== name || row.campaignId !== route.campaignId) throw new Error(name + " upload delta routing mismatch.");
        records.push(row);
      }
      routeResults.push({ route: name, campaignId: route.campaignId, records: rows.length, sourceSha256: artifact.sha256 });
    }
    if (seenRoutes.size !== Object.keys(EXPECTED).length) throw new Error("One or more required routes are missing.");
    if (records.length !== 5654 || new Set(records.map(record => record.email)).size !== 5654) throw new Error("Prepared upload must contain exactly 5654 globally unique emails.");

    routeResults.sort((left, right) => Object.keys(EXPECTED).indexOf(left.route) - Object.keys(EXPECTED).indexOf(right.route));
    records.sort((left, right) => left.route.localeCompare(right.route) || left.email.localeCompare(right.email));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const output = "email,route,campaign_id\n" + records.map(record => [record.email, record.route, record.campaignId].map(csv).join(",")).join("\n") + "\n";
    fs.writeFileSync(this.outputPath, output, "utf8");

    const report = {
      ok: true, service: this.service, mode: "APPLY_INTERNAL_PREPARATION", status: "ALL_SEGMENT_UPLOAD_PREPARED", generatedAt: this.generatedAt(),
      sourceAuditFingerprint: audit.auditFingerprint,
      summary: { routes: routeResults.length, prepared: records.length, globallyUniqueEmails: 5654, alreadyPresentGlobally: 2922, unclassifiedHeld: 2 },
      routes: routeResults,
      conservation: { ok: records.length + 2922 === 8576, classifiedCandidates: 8576, alreadyPresentGlobally: 2922, prepared: records.length },
      globalDeduplication: { ok: true, duplicateEmails: 0, comparedAgainstAllTenCampaigns: true },
      authorizationRequired: "AUTHORIZE_INSTANTLY_UPLOAD_5654_NO_LAUNCH",
      providerReadsAuthorized: false, providerWritesAuthorized: false, uploadAuthorized: false,
      leadsUploaded: 0, emailsSent: false, campaignsChanged: false, campaignsLaunched: false,
      artifact: { filePath: this.outputPath, records: records.length, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) }
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.preparationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.writeFileSync(this.manifestPath, JSON.stringify(report, null, 2), "utf8");
    report.manifest = { filePath: this.manifestPath, bytes: fs.statSync(this.manifestPath).size, sha256: sha256(fs.readFileSync(this.manifestPath)) };
    return report;
  }
}

module.exports = RevenueAllSegmentUploadPreparationService;
module.exports.RevenueAllSegmentUploadPreparationService = RevenueAllSegmentUploadPreparationService;
module.exports.EXPECTED = EXPECTED;
