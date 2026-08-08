"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ActivationPlanner = require("./RevenueInstantlyActivationPlanService");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }
function csv(value) { const text = String(value == null ? "" : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }

class RevenueGlobalInstantlyDuplicateAuditService {
  constructor(options = {}) {
    this.service = "REVENUE_GLOBAL_INSTANTLY_DUPLICATE_AUDIT";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.masterPath = options.masterPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_segment_activation", "verified_segment_master.jsonl");
    this.configurationPlanPath = options.configurationPlanPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_configuration", "plan.json");
    this.configurationApplyPath = options.configurationApplyPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_configuration_apply", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "global_instantly_duplicate_audit");
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
      providerWritesAuthorized: false, leadsUploaded: 0, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSON evidence is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSONL evidence is missing: " + filePath);
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
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < 1000; page += 1) {
      const response = await this.leadProvider({ campaign: campaignId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      const extracted = this.extract(response);
      if (!extracted.items.length) return records;
      records.push(...extracted.items);
      const next = normalize(extracted.next);
      if (!next) return records;
      if (seen.has(next)) throw new Error("Instantly lead pagination returned a repeated cursor.");
      seen.add(next);
      cursor = next;
    }
    throw new Error("Instantly lead pagination exceeded the safety limit.");
  }

  leadEmail(record) { return normalize(record.email || record.lead || record.contact || record.email_address); }

  async audit(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) throw new Error("Explicit --live read authorization is required.");

    const master = this.loadJsonl(this.masterPath);
    const plan = this.loadJson(this.configurationPlanPath);
    const applied = this.loadJson(this.configurationApplyPath);
    if (plan.ok !== true || plan.status !== "ALL_SEGMENT_CONFIGURATION_PLANNED" || plan.globalDeduplication?.ok !== true) throw new Error("Gate 13 configuration evidence is unhealthy.");
    if (applied.ok !== true || applied.status !== "SEGMENT_CONFIGURATION_COMPLETED" || applied.summary?.routesWithInboxes !== 10) throw new Error("Gate 14 configuration evidence is unhealthy.");
    if (master.length !== 8578 || new Set(master.map(lead => normalize(lead.email))).size !== 8578) throw new Error("Verified master must contain 8578 globally unique emails.");

    const appliedByRoute = new Map(applied.routes.map(route => [route.route, route]));
    const routes = plan.routes.filter(route => route.route !== "Unclassified").map(route => {
      const state = appliedByRoute.get(route.route) || {};
      const campaignId = String(state.campaignId || route.currentCampaignId || "").trim();
      if (!campaignId || state.paused !== true || state.inboxesConfigured !== true) throw new Error("Configured campaign evidence is incomplete for " + route.route + ".");
      return { route: route.route, campaignId, campaignName: route.currentCampaignName || route.proposedCampaignName };
    });
    if (routes.length !== 10 || new Set(routes.map(route => route.campaignId)).size !== 10) throw new Error("Gate 15 requires exactly ten distinct configured campaigns.");

    const campaignInventories = [];
    const globalProviderEmails = new Set();
    for (const route of routes) {
      const records = await this.readCampaignLeads(route.campaignId);
      const emails = new Set(records.map(record => this.leadEmail(record)).filter(Boolean));
      for (const email of emails) globalProviderEmails.add(email);
      campaignInventories.push({ ...route, providerRecords: records.length, providerUniqueEmails: emails.size });
    }

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const results = [];
    let totalCandidates = 0, totalExisting = 0, totalDelta = 0;
    for (const route of routes) {
      const candidates = master.filter(lead => this.planner.route(lead).name === route.route);
      const existing = candidates.filter(lead => globalProviderEmails.has(normalize(lead.email)));
      const delta = candidates.filter(lead => !globalProviderEmails.has(normalize(lead.email)));
      const safe = route.route.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const deltaPath = path.join(this.outputRoot, "upload_delta_" + safe + ".csv");
      const existingPath = path.join(this.outputRoot, "existing_global_" + safe + ".jsonl");
      fs.writeFileSync(deltaPath, "email,route,campaign_id\n" + delta.map(lead => [normalize(lead.email), route.route, route.campaignId].map(csv).join(",")).join("\n") + (delta.length ? "\n" : ""), "utf8");
      fs.writeFileSync(existingPath, existing.map(lead => JSON.stringify({ ...lead, disposition: "ALREADY_PRESENT_ANYWHERE_IN_INSTANTLY" })).join("\n") + (existing.length ? "\n" : ""), "utf8");
      results.push({
        route: route.route, campaignId: route.campaignId, campaignName: route.campaignName,
        candidates: candidates.length, alreadyPresentGlobally: existing.length, uploadDelta: delta.length,
        conservationOk: candidates.length === existing.length + delta.length,
        uploadAuthorized: false, launchAuthorized: false,
        artifacts: {
          uploadDelta: { filePath: deltaPath, records: delta.length, bytes: fs.statSync(deltaPath).size, sha256: sha256(fs.readFileSync(deltaPath)) },
          existing: { filePath: existingPath, records: existing.length, bytes: fs.statSync(existingPath).size, sha256: sha256(fs.readFileSync(existingPath)) }
        }
      });
      totalCandidates += candidates.length; totalExisting += existing.length; totalDelta += delta.length;
    }

    const unclassifiedHeld = master.filter(lead => this.planner.route(lead).name === "Unclassified").length;
    const report = {
      ok: true, service: this.service, mode: "APPLY_LIVE_READ_ONLY", status: "GLOBAL_DUPLICATE_AUDIT_COMPLETED", generatedAt: this.generatedAt(),
      sourceConfigurationFingerprint: plan.configurationFingerprint,
      sourceConfigurationApplyFingerprint: applied.configurationApplyFingerprint,
      summary: {
        campaignsAudited: routes.length, providerRecordsRead: campaignInventories.reduce((sum, item) => sum + item.providerRecords, 0),
        providerUniqueEmails: globalProviderEmails.size, classifiedCandidates: totalCandidates,
        alreadyPresentGlobally: totalExisting, uploadDelta: totalDelta, unclassifiedHeld
      },
      conservation: { ok: totalCandidates === totalExisting + totalDelta && totalCandidates + unclassifiedHeld === master.length, classifiedCandidates: totalCandidates, alreadyPresentGlobally: totalExisting, uploadDelta: totalDelta, unclassifiedHeld, verifiedMaster: master.length },
      globalProviderDeduplication: { enabled: true, comparedAgainstAllTenCampaigns: true },
      campaignInventories, routes: results,
      providerReadsPerformed: true, providerWritesAuthorized: false, leadsUploaded: 0, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
    if (!report.conservation.ok || results.some(route => !route.conservationOk)) throw new Error("Global duplicate audit conservation failed.");
    const identity = { ...report }; delete identity.generatedAt;
    report.auditFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return report;
  }
}

module.exports = RevenueGlobalInstantlyDuplicateAuditService;
module.exports.RevenueGlobalInstantlyDuplicateAuditService = RevenueGlobalInstantlyDuplicateAuditService;
