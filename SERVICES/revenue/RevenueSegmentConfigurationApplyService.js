"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function email(value) { return String(value || "").trim().toLowerCase(); }

class RevenueSegmentConfigurationApplyService {
  constructor(options = {}) {
    this.service = "REVENUE_SEGMENT_CONFIGURATION_APPLY";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.planPath = options.planPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_configuration", "plan.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_configuration_apply");
    this.progressPath = options.progressPath || path.join(this.outputRoot, "progress.json");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.authorization = options.authorization || "AUTHORIZE_GATE_14_SEGMENT_CONFIGURATION_2_CAMPAIGNS_9_INBOXES_NO_UPLOAD_NO_LAUNCH";
    this.createProvider = options.createProvider || (async payload => this.connector().createCampaign(payload));
    this.updateProvider = options.updateProvider || (async (id, payload) => this.connector().updateCampaign(id, payload));
    this.pauseProvider = options.pauseProvider || (async id => this.connector().pauseCampaign(id, "Gate 14 governed configuration safety pause"));
  }

  connector() {
    const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
    if (instantly.getConfiguration().liveMutationsEnabled !== true) throw new Error("Instantly live mutations are not enabled.");
    return instantly;
  }

  plan(input = {}) {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      requestedAuthorization: input.authorization || null,
      providerWritesAuthorized: false, campaignsCreated: 0, inboxAssignmentsChanged: 0,
      leadsUploaded: 0, emailsSent: false, campaignsLaunched: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required configuration evidence is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  persist(progress) {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const temporary = this.progressPath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(progress, null, 2), "utf8");
    fs.renameSync(temporary, this.progressPath);
  }

  allocation(route, pools) {
    if (/gsa/i.test(route)) return pools.gsa;
    if (route === "SBS") return pools.sbs;
    return pools.govcon;
  }

  createPayload(name, inboxes) {
    return {
      name,
      campaign_schedule: {
        schedules: [{
          name: "Weekdays",
          timing: { from: "09:00", to: "17:00" },
          days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
          timezone: "Etc/GMT+12"
        }],
        start_date: this.generatedAt().slice(0, 10)
      },
      email_list: inboxes,
      daily_limit: 0,
      daily_max_leads: 0,
      stop_on_reply: true,
      stop_on_auto_reply: true,
      allow_risky_contacts: false,
      disable_bounce_protect: false,
      text_only: true
    };
  }

  confirmed(result, action) {
    if (!result || typeof result !== "object" || result.dryRun === true || result.mutationExecuted === false) {
      throw new Error("Instantly did not confirm live " + action + ".");
    }
    return result;
  }

  async apply(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) throw new Error("Explicit --live configuration authorization is required.");
    if (input.authorization !== this.authorization) throw new Error("Exact CEO Gate 14 authorization is required.");

    const plan = this.loadJson(this.planPath);
    if (plan.ok !== true || plan.status !== "ALL_SEGMENT_CONFIGURATION_PLANNED" || plan.conservation?.ok !== true || plan.globalDeduplication?.ok !== true) throw new Error("Gate 13 configuration plan is unhealthy.");
    if (Number(plan.summary.verifiedLeads) !== 8578 || Number(plan.summary.uniqueEmails) !== 8578 || Number(plan.summary.unclassifiedLeads) !== 2) throw new Error("Gate 13 lead counts changed.");
    const classified = plan.routes.filter(route => route.route !== "Unclassified");
    const missing = classified.filter(route => !route.currentCampaignId);
    if (classified.length !== 10 || missing.length !== 2) throw new Error("Gate 14 requires exactly 10 classified routes and 2 missing campaigns.");

    const route = name => classified.find(item => item.route === name);
    const pools = {
      gsa: [...new Set((route("GSA")?.existingInboxes || []).map(email))],
      govcon: [...new Set((route("VA")?.existingInboxes || []).map(email))],
      sbs: [...new Set((route("SBS")?.existingInboxes || []).map(email))]
    };
    const allInboxes = [...new Set([...pools.gsa, ...pools.govcon, ...pools.sbs])];
    if (pools.gsa.length !== 3 || pools.govcon.length !== 5 || pools.sbs.length !== 1 || allInboxes.length !== 9) throw new Error("Gate 14 requires the validated 3 GSA, 5 GovCon, and 1 SBS inbox allocation.");

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const progress = fs.existsSync(this.progressPath) ? this.loadJson(this.progressPath) : {
      authorization: this.authorization,
      sourceConfigurationFingerprint: plan.configurationFingerprint,
      routes: {}
    };
    if (progress.authorization !== this.authorization || progress.sourceConfigurationFingerprint !== plan.configurationFingerprint) throw new Error("Existing Gate 14 progress does not match this authorization.");

    for (const item of classified) {
      const state = progress.routes[item.route] || {};
      const inboxes = this.allocation(item.route, pools);
      let campaignId = state.campaignId || item.currentCampaignId;

      if (!campaignId) {
        const created = this.confirmed(await this.createProvider(this.createPayload(item.proposedCampaignName, inboxes)), "campaign creation");
        campaignId = String(created.id || created.campaign_id || "").trim();
        if (!campaignId) throw new Error("Created campaign did not return an ID for " + item.route + ".");
        state.campaignId = campaignId;
        state.created = true;
        progress.routes[item.route] = state;
        this.persist(progress);
      }

      if (state.paused !== true) {
        this.confirmed(await this.pauseProvider(campaignId), "campaign pause");
        state.paused = true;
        progress.routes[item.route] = state;
        this.persist(progress);
      }

      if (state.inboxesConfigured !== true) {
        this.confirmed(await this.updateProvider(campaignId, {
          email_list: inboxes,
          daily_limit: 0,
          daily_max_leads: 0,
          allow_risky_contacts: false,
          disable_bounce_protect: false
        }), "campaign inbox configuration");
        state.inboxesConfigured = true;
        state.inboxes = inboxes;
        progress.routes[item.route] = state;
        this.persist(progress);
      }
    }

    const states = Object.entries(progress.routes).map(([routeName, state]) => ({ route: routeName, ...state }));
    const report = {
      ok: states.length === 10 && states.every(state => state.paused && state.inboxesConfigured),
      service: this.service, mode: "APPLY_LIVE_AUTHORIZED", status: "SEGMENT_CONFIGURATION_COMPLETED",
      generatedAt: this.generatedAt(), authorization: this.authorization,
      sourceConfigurationFingerprint: plan.configurationFingerprint,
      summary: {
        classifiedRoutes: 10,
        campaignsCreated: states.filter(state => state.created).length,
        campaignsPaused: states.filter(state => state.paused).length,
        routesWithInboxes: states.filter(state => state.inboxesConfigured).length,
        uniqueInboxesAssigned: new Set(states.flatMap(state => state.inboxes || [])).size,
        verifiedLeadsCovered: classified.reduce((sum, item) => sum + Number(item.verifiedLeads), 0),
        unclassifiedHeld: 2
      },
      routes: states,
      providerWritesAuthorized: true,
      providerWriteScope: "CREATE_2_CAMPAIGNS_PAUSE_10_CAMPAIGNS_ASSIGN_9_INBOXES",
      leadsUploaded: 0, emailsSent: false, campaignsLaunched: false,
      globalDeduplicationPreserved: true
    };
    if (!report.ok || report.summary.campaignsCreated !== 2 || report.summary.uniqueInboxesAssigned !== 9 || report.summary.verifiedLeadsCovered !== 8576) throw new Error("Gate 14 configuration conservation failed.");
    const identity = { ...report }; delete identity.generatedAt;
    report.configurationApplyFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueSegmentConfigurationApplyService;
module.exports.RevenueSegmentConfigurationApplyService = RevenueSegmentConfigurationApplyService;
