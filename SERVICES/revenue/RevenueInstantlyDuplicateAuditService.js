"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ActivationPlanner = require("./RevenueInstantlyActivationPlanService");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }
function csv(value) { const text = String(value == null ? "" : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }

class RevenueInstantlyDuplicateAuditService {
  constructor(options = {}) {
    this.service = "REVENUE_INSTANTLY_DUPLICATE_AUDIT";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.activationPlanPath = options.activationPlanPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_activation_plan.json");
    this.verifiedMasterPath = options.verifiedMasterPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_segment_activation", "verified_segment_master.jsonl");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_duplicate_audit");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.planner = options.planner || new ActivationPlanner({ rootDir: this.rootDir });
    this.leadProvider = options.leadProvider || (async filters => {
      const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
      return instantly.listLeads(filters);
    });
  }

  plan(input = {}) {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      liveProviderReadRequested: input.live === true,
      providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSON file is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSONL file is missing: " + filePath);
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  extract(response) {
    if (Array.isArray(response)) return { items: response, next: null };
    for (const key of ["items", "leads", "data", "results"]) {
      if (Array.isArray(response?.[key])) return { items: response[key], next: response.next_starting_after || response.nextStartingAfter || null };
    }
    throw new Error("Instantly lead response does not contain an array.");
  }

  async readCampaignLeads(campaignId) {
    const records = [];
    let startingAfter = null;
    for (let page = 0; page < 100; page += 1) {
      const response = await this.leadProvider({
        campaign_id: campaignId,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });
      const extracted = this.extract(response);
      records.push(...extracted.items);
      startingAfter = extracted.next;
      if (!startingAfter) return records;
    }
    throw new Error("Instantly lead pagination exceeded the safety limit.");
  }

  leadEmail(record) {
    return normalize(record.email || record.lead || record.contact || record.email_address);
  }

  async audit(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) throw new Error("Explicit --live read authorization is required.");
    const plan = this.loadJson(this.activationPlanPath);
    if (plan.ok !== true || plan.status !== "ACTIVATION_PLAN_PREPARED") throw new Error("Instantly activation plan is unhealthy.");
    const master = this.loadJsonl(this.verifiedMasterPath);
    if (master.length !== Number(plan.summary.verifiedLeads)) throw new Error("Verified lead count does not match the activation plan.");

    const eligible = plan.activationRoutes.filter(route =>
      route.liveCampaignId &&
      route.blockers.length === 1 &&
      route.blockers[0] === "PROVIDER_DUPLICATE_SUPPRESSION_CHECK_REQUIRED"
    );
    if (!eligible.length) throw new Error("No activation routes are eligible for provider duplicate audit.");

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const routes = [];
    let totalCandidates = 0, totalExisting = 0, totalUploadDelta = 0;
    for (const route of eligible) {
      const candidates = master.filter(lead => this.planner.route(lead).name === route.route);
      const providerRecords = await this.readCampaignLeads(route.liveCampaignId);
      const providerEmails = new Set(providerRecords.map(record => this.leadEmail(record)).filter(Boolean));
      const existing = candidates.filter(lead => providerEmails.has(normalize(lead.email)));
      const uploadDelta = candidates.filter(lead => !providerEmails.has(normalize(lead.email)));
      const safeName = route.route.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const uploadPath = path.join(this.outputRoot, "upload_delta_" + safeName + ".csv");
      const uploadText = "email,route,campaign_id\n" + uploadDelta.map(lead => [normalize(lead.email), route.route, route.liveCampaignId].map(csv).join(",")).join("\n") + (uploadDelta.length ? "\n" : "");
      fs.writeFileSync(uploadPath, uploadText, "utf8");
      const duplicatePath = path.join(this.outputRoot, "existing_" + safeName + ".jsonl");
      const duplicateText = existing.map(lead => JSON.stringify({ ...lead, disposition: "ALREADY_IN_INSTANTLY_CAMPAIGN" })).join("\n") + (existing.length ? "\n" : "");
      fs.writeFileSync(duplicatePath, duplicateText, "utf8");
      routes.push({
        route: route.route, liveCampaignId: route.liveCampaignId, campaignName: route.campaignName,
        candidates: candidates.length, providerLeadsRead: providerRecords.length,
        alreadyPresent: existing.length, uploadDelta: uploadDelta.length,
        duplicateAuditPassed: candidates.length === existing.length + uploadDelta.length,
        uploadAuthorized: false, launchAuthorized: false,
        artifacts: {
          uploadDelta: { filePath: uploadPath, records: uploadDelta.length, bytes: fs.statSync(uploadPath).size, sha256: sha256(fs.readFileSync(uploadPath)) },
          existing: { filePath: duplicatePath, records: existing.length, bytes: fs.statSync(duplicatePath).size, sha256: sha256(fs.readFileSync(duplicatePath)) }
        }
      });
      totalCandidates += candidates.length; totalExisting += existing.length; totalUploadDelta += uploadDelta.length;
    }

    const report = {
      ok: true, service: this.service, mode: "APPLY_LIVE_READ_ONLY", status: "DUPLICATE_AUDIT_COMPLETED", generatedAt: this.generatedAt(),
      sourcePlanFingerprint: plan.planFingerprint,
      summary: { eligibleRoutes: routes.length, candidates: totalCandidates, alreadyPresent: totalExisting, uploadDelta: totalUploadDelta, providerLeadsRead: routes.reduce((sum, route) => sum + route.providerLeadsRead, 0) },
      conservation: { ok: totalCandidates === totalExisting + totalUploadDelta, candidates: totalCandidates, alreadyPresent: totalExisting, uploadDelta: totalUploadDelta },
      routes,
      providerReadsPerformed: true, providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
    if (!report.conservation.ok || routes.some(route => !route.duplicateAuditPassed)) throw new Error("Provider duplicate audit conservation failed.");
    const identity = { ...report }; delete identity.generatedAt;
    report.auditFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return report;
  }
}

module.exports = RevenueInstantlyDuplicateAuditService;
module.exports.RevenueInstantlyDuplicateAuditService = RevenueInstantlyDuplicateAuditService;
