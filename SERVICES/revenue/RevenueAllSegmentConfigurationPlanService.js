"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ActivationPlanner = require("./RevenueInstantlyActivationPlanService");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

class RevenueAllSegmentConfigurationPlanService {
  constructor(options = {}) {
    this.service = "REVENUE_ALL_SEGMENT_CONFIGURATION_PLAN";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.masterPath = options.masterPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_segment_activation", "verified_segment_master.jsonl");
    this.activationPlanPath = options.activationPlanPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_activation_plan.json");
    this.uploadManifestPath = options.uploadManifestPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_governed_upload", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_configuration");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "plan.json");
    this.unclassifiedPath = options.unclassifiedPath || path.join(this.outputRoot, "unclassified_review.jsonl");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.planner = options.planner || new ActivationPlanner({ rootDir: this.rootDir });
    this.campaignProvider = options.campaignProvider || (async filters => {
      const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
      return instantly.listCampaigns(filters);
    });
    this.accountProvider = options.accountProvider || (async filters => {
      const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
      return instantly.listAccounts(filters);
    });
  }

  plan() {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      liveProviderReadRequested: false, providerWritesAuthorized: false,
      campaignsCreated: 0, inboxAssignmentsChanged: 0, leadsUploaded: 0,
      emailsSent: false, campaignsLaunched: false
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
    for (const key of ["items", "campaigns", "accounts", "data", "results"]) {
      if (Array.isArray(response?.[key])) return { items: response[key], next: response.next_starting_after || response.nextStartingAfter || null };
    }
    throw new Error("Instantly provider response does not contain an inventory array.");
  }

  async readAll(provider) {
    const records = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < 1000; page += 1) {
      const response = await provider({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      const extracted = this.extract(response);
      if (!extracted.items.length) return records;
      records.push(...extracted.items);
      const next = String(extracted.next || "").trim();
      if (!next) return records;
      if (seen.has(next)) throw new Error("Instantly inventory pagination returned a repeated cursor.");
      seen.add(next);
      cursor = next;
    }
    throw new Error("Instantly inventory pagination exceeded the safety limit.");
  }

  campaignId(record) { return String(record.id || record.campaign_id || record.campaignId || "").trim(); }
  campaignName(record) { return String(record.name || record.campaign_name || record.campaignName || "").trim(); }
  accountEmail(record) { return String(record.email || record.account || record.address || "").trim().toLowerCase(); }

  isHealthyAccount(record) {
    const email = this.accountEmail(record);
    if (!email) return false;
    const status = String(record.status == null ? "" : record.status).toLowerCase();
    if (["-1", "-2", "inactive", "disabled", "error", "suspended"].includes(status)) return false;
    return true;
  }

  findCampaign(route, prior, campaigns) {
    if (prior?.liveCampaignId) {
      const exactId = campaigns.find(item => this.campaignId(item) === String(prior.liveCampaignId));
      if (exactId) return exactId;
    }
    const target = normalize(route);
    const aliases = {
      "8 a": ["8 a", "8a"],
      "hubzone": ["hubzone", "hub zone"],
      "sbs": ["sbs", "small business"],
      "gsa": ["gsa no sales", "gsa"],
      "va": ["va no sales", "va"]
    };
    const targets = aliases[target] || [target];
    return campaigns.find(item => {
      const name = normalize(this.campaignName(item));
      return targets.some(value => name === value || name.includes(value) || value.includes(name));
    }) || null;
  }

  async build(input = {}) {
    if (input.apply !== true) return this.plan();
    if (input.live !== true) throw new Error("Explicit --live read authorization is required.");

    const master = this.loadJsonl(this.masterPath);
    const activation = this.loadJson(this.activationPlanPath);
    const upload = this.loadJson(this.uploadManifestPath);
    if (activation.ok !== true || activation.status !== "ACTIVATION_PLAN_PREPARED") throw new Error("Activation plan evidence is unhealthy.");
    if (upload.ok !== true || upload.status !== "UPLOAD_COMPLETED" || Number(upload.summary.uploaded) !== 522) throw new Error("Gate 12 upload evidence is unhealthy.");
    if (master.length !== Number(activation.summary.verifiedLeads) || master.length !== 8578) throw new Error("Verified master must contain exactly 8578 leads.");
    const emails = master.map(item => String(item.email || "").trim().toLowerCase());
    if (emails.some(email => !email) || new Set(emails).size !== master.length) throw new Error("Verified master contains missing or duplicate emails.");

    const [campaigns, accounts] = await Promise.all([
      this.readAll(this.campaignProvider),
      this.readAll(this.accountProvider)
    ]);
    const healthyAccounts = accounts.filter(item => this.isHealthyAccount(item));
    const healthyEmails = [...new Set(healthyAccounts.map(item => this.accountEmail(item)))].sort();
    const activationByRoute = new Map(activation.activationRoutes.map(item => [item.route, item]));
    const groups = new Map();
    for (const lead of master) {
      const route = this.planner.route(lead).name;
      if (!groups.has(route)) groups.set(route, []);
      groups.get(route).push(lead);
    }

    const usedAccounts = new Set();
    for (const prior of activation.activationRoutes) {
      for (const email of (prior.assignedInboxes || [])) usedAccounts.add(String(email).toLowerCase());
    }
    const availableAccounts = healthyEmails.filter(email => !usedAccounts.has(email));
    let accountIndex = 0;
    const routes = [];

    for (const [route, leads] of groups.entries()) {
      const prior = activationByRoute.get(route) || null;
      const campaign = this.findCampaign(route, prior, campaigns);
      const existingInboxes = [...new Set((prior?.assignedInboxes || []).map(email => String(email).toLowerCase()).filter(Boolean))];
      const proposedInboxes = [...existingInboxes];
      if (!proposedInboxes.length && accountIndex < availableAccounts.length && route !== "Unclassified") {
        proposedInboxes.push(availableAccounts[accountIndex]);
        accountIndex += 1;
      }
      const blockers = [];
      if (route === "Unclassified") blockers.push("CLASSIFICATION_REVIEW_REQUIRED");
      if (!campaign) blockers.push("CAMPAIGN_CREATION_REQUIRED");
      if (!proposedInboxes.length) blockers.push("SENDING_INBOX_ASSIGNMENT_REQUIRED");
      blockers.push("GLOBAL_PROVIDER_DUPLICATE_AUDIT_REQUIRED");
      routes.push({
        route,
        priority: this.planner.route(leads[0]).rank,
        verifiedLeads: leads.length,
        currentCampaignId: campaign ? this.campaignId(campaign) : null,
        currentCampaignName: campaign ? this.campaignName(campaign) : null,
        proposedCampaignName: campaign ? this.campaignName(campaign) : route + " - Verified",
        existingInboxes,
        proposedInboxes,
        configurationActions: [
          ...(!campaign ? ["CREATE_PAUSED_CAMPAIGN"] : []),
          ...(!existingInboxes.length && proposedInboxes.length ? ["ASSIGN_SENDER_INBOX"] : [])
        ],
        blockers: [...new Set(blockers)],
        uploadAuthorized: false,
        launchAuthorized: false
      });
    }
    routes.sort((a, b) => a.priority - b.priority || a.route.localeCompare(b.route));

    const unclassified = master.filter(lead => this.planner.route(lead).name === "Unclassified");
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(this.unclassifiedPath, unclassified.map(JSON.stringify).join("\n") + (unclassified.length ? "\n" : ""), "utf8");

    const configuredLeads = routes.filter(route => route.currentCampaignId && route.proposedInboxes.length && route.route !== "Unclassified").reduce((sum, route) => sum + route.verifiedLeads, 0);
    const report = {
      ok: true, service: this.service, mode: "APPLY_LIVE_READ_ONLY", status: "ALL_SEGMENT_CONFIGURATION_PLANNED", generatedAt: this.generatedAt(),
      sourceActivationFingerprint: activation.planFingerprint,
      sourceUploadFingerprint: upload.uploadFingerprint,
      summary: {
        verifiedLeads: master.length, uniqueEmails: new Set(emails).size, routes: routes.length,
        liveCampaignsRead: campaigns.length, senderAccountsRead: accounts.length, healthySenderAccounts: healthyEmails.length,
        configuredLeads, leadsRequiringConfiguration: master.length - configuredLeads - unclassified.length,
        unclassifiedLeads: unclassified.length,
        campaignsToCreate: routes.filter(route => route.configurationActions.includes("CREATE_PAUSED_CAMPAIGN")).length,
        inboxAssignmentsToAdd: routes.filter(route => route.configurationActions.includes("ASSIGN_SENDER_INBOX")).length
      },
      conservation: { ok: routes.reduce((sum, route) => sum + route.verifiedLeads, 0) === master.length, routed: routes.reduce((sum, route) => sum + route.verifiedLeads, 0), verifiedLeads: master.length },
      globalDeduplication: { ok: new Set(emails).size === master.length, duplicateEmails: master.length - new Set(emails).size, onePrimaryRoutePerLead: true },
      routes,
      providerReadsPerformed: true, providerWritesAuthorized: false,
      campaignsCreated: 0, inboxAssignmentsChanged: 0, leadsUploaded: 0,
      emailsSent: false, campaignsChanged: false, campaignsLaunched: false,
      artifacts: {
        unclassifiedReview: { filePath: this.unclassifiedPath, records: unclassified.length, bytes: fs.statSync(this.unclassifiedPath).size, sha256: sha256(fs.readFileSync(this.unclassifiedPath)) }
      }
    };
    if (!report.conservation.ok || !report.globalDeduplication.ok) throw new Error("All-segment conservation or deduplication failed.");
    const identity = { ...report }; delete identity.generatedAt;
    report.configurationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifacts.plan = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueAllSegmentConfigurationPlanService;
module.exports.RevenueAllSegmentConfigurationPlanService = RevenueAllSegmentConfigurationPlanService;
