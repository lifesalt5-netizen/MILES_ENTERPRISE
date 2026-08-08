"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }

class RevenueInstantlyGovernedUploadService {
  constructor(options = {}) {
    this.service = "REVENUE_INSTANTLY_GOVERNED_UPLOAD";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.auditRoot = options.auditRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_duplicate_audit");
    this.auditManifestPath = options.auditManifestPath || path.join(this.auditRoot, "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_governed_upload");
    this.progressPath = options.progressPath || path.join(this.outputRoot, "upload_progress.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.expectedAuthorization = options.expectedAuthorization || "AUTHORIZE_INSTANTLY_UPLOAD_473_NO_LAUNCH";
    this.uploadProvider = options.uploadProvider || (async payload => {
      const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
      const configuration = instantly.getConfiguration();
      if (configuration.liveMutationsEnabled !== true) throw new Error("Instantly live mutations are not enabled for the authorized upload.");
      return instantly.createLead(payload);
    });
  }

  plan(input = {}) {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      requestedAuthorization: input.authorization || null, maximumUploads: 473,
      providerWritesAuthorized: false, leadsUploaded: 0,
      emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSON evidence is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadRows(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Upload delta is missing: " + filePath);
    const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.shift() !== "email,route,campaign_id") throw new Error("Upload delta header is invalid.");
    return lines.map(line => {
      const [email, route, campaignId] = line.split(",");
      return { email: normalize(email), route: String(route || "").trim(), campaignId: String(campaignId || "").trim() };
    });
  }

  persistProgress(progress) {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const temporary = this.progressPath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(progress, null, 2), "utf8");
    fs.renameSync(temporary, this.progressPath);
  }

  async upload(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) throw new Error("Explicit --live authorization is required.");
    if (input.authorization !== this.expectedAuthorization) throw new Error("Exact CEO upload authorization is required.");
    if (Number(input.maximumUploads) !== 473) throw new Error("The authorized upload cap must equal exactly 473.");

    const audit = this.loadJson(this.auditManifestPath);
    if (audit.ok !== true || audit.status !== "DUPLICATE_AUDIT_COMPLETED" || audit.conservation?.ok !== true) throw new Error("Gate 11 duplicate audit evidence is unhealthy.");
    if (Number(audit.summary.uploadDelta) !== 473 || Number(audit.summary.candidates) !== 908 || Number(audit.summary.alreadyPresent) !== 435) throw new Error("Gate 11 authorized counts do not match 908 = 435 + 473.");
    if (audit.providerWritesAuthorized !== false || audit.leadsUploaded !== false || audit.campaignsLaunched !== false) throw new Error("Gate 11 safety evidence is invalid.");

    const rows = [];
    for (const route of audit.routes) {
      const artifact = route.artifacts?.uploadDelta;
      if (!artifact || sha256(fs.readFileSync(artifact.filePath)) !== artifact.sha256) throw new Error("Upload delta integrity check failed for " + route.route + ".");
      const routeRows = this.loadRows(artifact.filePath);
      if (routeRows.length !== Number(artifact.records) || routeRows.length !== Number(route.uploadDelta)) throw new Error("Upload delta count mismatch for " + route.route + ".");
      rows.push(...routeRows);
    }
    if (rows.length !== 473) throw new Error("Authorized upload inventory must contain exactly 473 leads.");
    if (new Set(rows.map(row => row.email)).size !== rows.length) throw new Error("Authorized upload inventory contains duplicate emails.");
    if (rows.some(row => !row.email || !row.route || !row.campaignId)) throw new Error("Authorized upload inventory contains incomplete records.");

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const prior = fs.existsSync(this.progressPath) ? this.loadJson(this.progressPath) : {
      authorization: this.expectedAuthorization,
      sourceAuditFingerprint: audit.auditFingerprint,
      completed: []
    };
    if (prior.authorization !== this.expectedAuthorization || prior.sourceAuditFingerprint !== audit.auditFingerprint) throw new Error("Existing upload progress does not match this authorization.");
    const completed = new Map((prior.completed || []).map(item => [normalize(item.email), item]));
    let uploadedThisRun = 0;

    for (const row of rows) {
      if (completed.has(row.email)) continue;
      const result = await this.uploadProvider({ email: row.email, campaign: row.campaignId });
      if (!result || typeof result !== "object" || result.dryRun === true || result.mutationExecuted === false) throw new Error("Instantly did not confirm a live lead upload for " + row.email + ".");
      completed.set(row.email, { ...row, uploadedAt: this.generatedAt(), providerLeadId: result.id || result.lead_id || result.uuid || null });
      uploadedThisRun += 1;
      this.persistProgress({
        authorization: this.expectedAuthorization,
        sourceAuditFingerprint: audit.auditFingerprint,
        completed: [...completed.values()]
      });
    }

    const completedRows = [...completed.values()];
    const byRoute = Object.fromEntries(audit.routes.map(route => [
      route.route,
      completedRows.filter(item => item.route === route.route).length
    ]));
    const report = {
      ok: completedRows.length === 473,
      service: this.service, mode: "APPLY_LIVE_AUTHORIZED", status: completedRows.length === 473 ? "UPLOAD_COMPLETED" : "UPLOAD_INCOMPLETE",
      generatedAt: this.generatedAt(), authorization: this.expectedAuthorization,
      sourceAuditFingerprint: audit.auditFingerprint,
      summary: { authorized: 473, uploaded: completedRows.length, uploadedThisRun, byRoute },
      conservation: { ok: completedRows.length === 473, authorized: 473, uploaded: completedRows.length },
      providerWritesAuthorized: true, providerWriteScope: "CREATE_LEADS_ONLY",
      leadsUploaded: completedRows.length, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
    if (!report.ok) throw new Error("Authorized upload did not complete.");
    const identity = { ...report }; delete identity.generatedAt;
    report.uploadFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return report;
  }
}

module.exports = RevenueInstantlyGovernedUploadService;
module.exports.RevenueInstantlyGovernedUploadService = RevenueInstantlyGovernedUploadService;
