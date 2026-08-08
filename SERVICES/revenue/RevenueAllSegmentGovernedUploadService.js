"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }

const AUTHORIZATION = "AUTHORIZE_INSTANTLY_UPLOAD_5654_NO_LAUNCH";
const PREPARATION_FINGERPRINT = "3A6230F2B3C605359A22F3AF5B03CEAD2B0A0F5EBF1EBDE14F173E9A0B0F69F0";
const ARTIFACT_SHA256 = "F68F429B45E3F1452447A2CEE17F2A44F8C3BF6354393FA85942EC3F413D18E1";
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

class RevenueAllSegmentGovernedUploadService {
  constructor(options = {}) {
    this.service = "REVENUE_ALL_SEGMENT_GOVERNED_UPLOAD";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.preparationRoot = options.preparationRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_upload_preparation");
    this.preparationManifestPath = options.preparationManifestPath || path.join(this.preparationRoot, "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_governed_upload");
    this.progressPath = options.progressPath || path.join(this.outputRoot, "upload_progress.jsonl");
    this.manifestPath = options.manifestPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
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
      requestedAuthorization: input.authorization || null, maximumUploads: 5654,
      providerWritesAuthorized: false, leadsUploaded: 0, emailsSent: false,
      campaignsChanged: false, campaignsLaunched: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required upload evidence is missing: " + filePath);
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
    if (quoted) throw new Error("Prepared upload contains an unterminated CSV field.");
    if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
    const header = (rows.shift() || []).map(normalize);
    if (header.join(",") !== "email,route,campaign_id") throw new Error("Prepared upload header is invalid.");
    return rows.filter(values => values.some(value => String(value).trim())).map(values => {
      if (values.length !== 3) throw new Error("Prepared upload row has an invalid column count.");
      return { email: normalize(values[0]), route: String(values[1] || "").trim(), campaignId: String(values[2] || "").trim() };
    });
  }

  loadProgress(sourceFingerprint, sourceSha256) {
    if (!fs.existsSync(this.progressPath)) return new Map();
    const completed = new Map();
    const lines = fs.readFileSync(this.progressPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const item = JSON.parse(line);
      if (item.authorization !== AUTHORIZATION || item.sourcePreparationFingerprint !== sourceFingerprint || item.sourceArtifactSha256 !== sourceSha256) throw new Error("Existing upload progress does not match this authorization and source.");
      const email = normalize(item.email);
      if (!email || completed.has(email)) throw new Error("Existing upload progress contains an invalid or duplicate email.");
      completed.set(email, item);
    }
    return completed;
  }

  appendProgress(item) {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.appendFileSync(this.progressPath, JSON.stringify(item) + "\n", "utf8");
  }

  async upload(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) throw new Error("Explicit --live authorization is required.");
    if (input.authorization !== AUTHORIZATION) throw new Error("Exact CEO upload authorization is required.");
    if (Number(input.maximumUploads) !== 5654) throw new Error("The authorized upload cap must equal exactly 5654.");

    const preparation = this.loadJson(this.preparationManifestPath);
    if (preparation.ok !== true || preparation.status !== "ALL_SEGMENT_UPLOAD_PREPARED" || preparation.conservation?.ok !== true || preparation.globalDeduplication?.ok !== true) throw new Error("Gate 17 preparation evidence is unhealthy.");
    if (preparation.preparationFingerprint !== PREPARATION_FINGERPRINT) throw new Error("Gate 17 preparation fingerprint changed.");
    if (preparation.authorizationRequired !== AUTHORIZATION || preparation.providerWritesAuthorized !== false || preparation.uploadAuthorized !== false || Number(preparation.leadsUploaded) !== 0 || preparation.emailsSent !== false || preparation.campaignsLaunched !== false) throw new Error("Gate 17 authority boundary is invalid.");
    if (Number(preparation.summary?.prepared) !== 5654 || Number(preparation.summary?.globallyUniqueEmails) !== 5654) throw new Error("Gate 17 prepared totals changed.");
    const artifact = preparation.artifact;
    if (!artifact?.filePath || !fs.existsSync(artifact.filePath)) throw new Error("Gate 17 prepared upload artifact is missing.");
    const artifactBytes = fs.readFileSync(artifact.filePath);
    if (artifact.sha256 !== ARTIFACT_SHA256 || sha256(artifactBytes) !== ARTIFACT_SHA256 || Number(artifact.records) !== 5654) throw new Error("Gate 17 prepared upload integrity check failed.");

    const rows = this.parseCsv(artifactBytes.toString("utf8").replace(/^\uFEFF/, ""));
    if (rows.length !== 5654 || new Set(rows.map(row => row.email)).size !== 5654) throw new Error("Authorized upload inventory must contain exactly 5654 globally unique emails.");
    if (rows.some(row => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || !row.route || !row.campaignId)) throw new Error("Authorized upload inventory contains an invalid record.");
    const byRoute = Object.fromEntries(Object.keys(EXPECTED).map(route => [route, rows.filter(row => row.route === route).length]));
    if (rows.some(row => !Object.prototype.hasOwnProperty.call(EXPECTED, row.route)) || Object.entries(EXPECTED).some(([route, count]) => byRoute[route] !== count)) throw new Error("Authorized upload route counts changed.");

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const completed = this.loadProgress(preparation.preparationFingerprint, artifact.sha256);
    const inventoryEmails = new Set(rows.map(row => row.email));
    if ([...completed.keys()].some(email => !inventoryEmails.has(email))) throw new Error("Existing upload progress contains an email outside the authorized inventory.");
    let uploadedThisRun = 0;

    for (const row of rows) {
      if (completed.has(row.email)) continue;
      const result = await this.uploadProvider({ email: row.email, campaign: row.campaignId });
      if (!result || typeof result !== "object" || result.dryRun === true || result.mutationExecuted === false) throw new Error("Instantly did not confirm a live lead creation for " + row.email + ".");
      const item = {
        authorization: AUTHORIZATION,
        sourcePreparationFingerprint: preparation.preparationFingerprint,
        sourceArtifactSha256: artifact.sha256,
        ...row,
        uploadedAt: this.generatedAt(),
        providerLeadId: result.id || result.lead_id || result.uuid || null
      };
      this.appendProgress(item);
      completed.set(row.email, item);
      uploadedThisRun += 1;
    }

    const completedRows = [...completed.values()];
    const completedByRoute = Object.fromEntries(Object.keys(EXPECTED).map(route => [route, completedRows.filter(item => item.route === route).length]));
    const complete = completedRows.length === 5654 && Object.entries(EXPECTED).every(([route, count]) => completedByRoute[route] === count);
    const report = {
      ok: complete, service: this.service, mode: "APPLY_LIVE_AUTHORIZED", status: complete ? "UPLOAD_COMPLETED" : "UPLOAD_INCOMPLETE",
      generatedAt: this.generatedAt(), authorization: AUTHORIZATION,
      sourcePreparationFingerprint: preparation.preparationFingerprint, sourceArtifactSha256: artifact.sha256,
      summary: { authorized: 5654, uploaded: completedRows.length, uploadedThisRun, byRoute: completedByRoute },
      conservation: { ok: complete, authorized: 5654, uploaded: completedRows.length },
      providerWritesAuthorized: true, providerWriteScope: "CREATE_LEADS_ONLY",
      leadsUploaded: completedRows.length, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
    if (!complete) throw new Error("Authorized upload did not complete.");
    const identity = { ...report }; delete identity.generatedAt;
    report.uploadFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.writeFileSync(this.manifestPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.manifestPath, bytes: fs.statSync(this.manifestPath).size, sha256: sha256(fs.readFileSync(this.manifestPath)) };
    return report;
  }
}

module.exports = RevenueAllSegmentGovernedUploadService;
module.exports.RevenueAllSegmentGovernedUploadService = RevenueAllSegmentGovernedUploadService;
module.exports.AUTHORIZATION = AUTHORIZATION;
module.exports.EXPECTED = EXPECTED;
