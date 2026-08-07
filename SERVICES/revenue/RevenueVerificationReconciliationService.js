"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase(); }

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value); value = "";
      if (row.some(cell => String(cell).trim())) rows.push(row);
      row = [];
    } else value += c;
  }
  if (value || row.length) { row.push(value); if (row.some(cell => String(cell).trim())) rows.push(row); }
  return rows;
}

class RevenueVerificationReconciliationService {
  constructor(options = {}) {
    this.service = "REVENUE_VERIFICATION_RECONCILIATION";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.batchRoot = options.batchRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_batch");
    this.batchPath = options.batchPath || path.join(this.batchRoot, "millionverifier_batch.csv");
    this.batchManifestPath = options.batchManifestPath || path.join(this.batchRoot, "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  plan(input = {}) {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      reportPath: input.reportPath || null, providerWritesAuthorized: false,
      leadsUploaded: false, emailsSent: false
    };
  }

  loadCsv(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("CSV file is missing: " + filePath);
    const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
    if (rows.length < 2) throw new Error("CSV file contains no data rows: " + filePath);
    const headers = rows[0].map(normalize);
    return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, String(values[index] || "").trim()])));
  }

  writeJsonl(name, records) {
    const filePath = path.join(this.outputRoot, name);
    const text = records.map(JSON.stringify).join("\n") + (records.length ? "\n" : "");
    fs.writeFileSync(filePath, text, "utf8");
    return { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
  }

  reconcile(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (!input.reportPath) throw new Error("--report is required.");
    if (!fs.existsSync(this.batchManifestPath)) throw new Error("Verification batch manifest is missing.");
    const batchManifest = JSON.parse(fs.readFileSync(this.batchManifestPath, "utf8").replace(/^\uFEFF/, ""));
    if (batchManifest.ok !== true || batchManifest.status !== "BATCH_PREPARED" || batchManifest.conservation?.ok !== true) {
      throw new Error("Verification batch evidence is unhealthy.");
    }
    const batch = this.loadCsv(this.batchPath);
    const report = this.loadCsv(path.resolve(input.reportPath));
    const required = ["email", "quality", "result"];
    for (const header of required) if (!Object.prototype.hasOwnProperty.call(report[0], header)) throw new Error("MillionVerifier report is missing " + header + ".");

    const batchEmails = batch.map(row => normalize(row.email));
    const reportEmails = report.map(row => normalize(row.email));
    const batchSet = new Set(batchEmails);
    const reportSet = new Set(reportEmails);
    if (batchSet.size !== batchEmails.length) throw new Error("Authorized batch contains duplicate emails.");
    if (reportSet.size !== reportEmails.length) throw new Error("MillionVerifier report contains duplicate emails.");
    const missing = batchEmails.filter(email => !reportSet.has(email));
    const extra = reportEmails.filter(email => !batchSet.has(email));
    if (missing.length || extra.length || batchEmails.length !== reportEmails.length) {
      throw new Error("MillionVerifier report does not exactly match the authorized batch.");
    }

    const good = [], risky = [], bad = [];
    for (const row of report) {
      const quality = normalize(row.quality);
      const result = normalize(row.result);
      const output = { ...row, email: normalize(row.email), quality, result };
      if (quality === "good" && result === "ok") good.push({ ...output, disposition: "SEND_READY" });
      else if (quality === "risky" && (result === "catch_all" || result === "unknown")) risky.push({ ...output, disposition: "BLOCKED_RISKY" });
      else if (quality === "bad" && result === "invalid") bad.push({ ...output, disposition: "DO_NOT_MAIL" });
      else throw new Error("Unsupported MillionVerifier quality/result combination: " + quality + "/" + result);
    }

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const artifacts = {
      sendReady: this.writeJsonl("verified_send_ready.jsonl", good),
      risky: this.writeJsonl("risky_blocked.jsonl", risky),
      doNotMail: this.writeJsonl("invalid_do_not_mail.jsonl", bad)
    };
    const resultCounts = {};
    for (const row of report) resultCounts[normalize(row.result)] = (resultCounts[normalize(row.result)] || 0) + 1;
    const manifest = {
      ok: true, service: this.service, mode: "APPLY", status: "RECONCILED",
      generatedAt: this.generatedAt(),
      sourceBatchFingerprint: batchManifest.batchFingerprint,
      reportPath: path.resolve(input.reportPath),
      reportSha256: sha256(fs.readFileSync(path.resolve(input.reportPath))),
      summary: {
        authorizedBatch: batch.length, reportRows: report.length,
        sendReady: good.length, riskyBlocked: risky.length, doNotMail: bad.length,
        resultCounts,
        freeAddresses: report.filter(row => normalize(row.free) === "yes").length,
        roleAddresses: report.filter(row => normalize(row.role) === "yes").length
      },
      conservation: { ok: good.length + risky.length + bad.length === batch.length, classified: good.length + risky.length + bad.length, authorizedBatch: batch.length },
      exactBatchMatch: { ok: true, missing: 0, extra: 0, duplicateBatchEmails: 0, duplicateReportEmails: 0 },
      policy: { good: "SEND_READY", risky: "BLOCKED_RISKY", bad: "DO_NOT_MAIL" },
      providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false,
      artifacts
    };
    if (!manifest.conservation.ok) throw new Error("Verification result conservation failed.");
    const identity = { ...manifest }; delete identity.generatedAt;
    manifest.reconciliationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    manifest.artifacts.manifest = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return manifest;
  }
}

module.exports = RevenueVerificationReconciliationService;
module.exports.RevenueVerificationReconciliationService = RevenueVerificationReconciliationService;
module.exports.parseCsv = parseCsv;
