"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CAPS = {
  "Expiring GSA 12 Months": 45,
  "GSA": 15,
  "Expiring VA 12 Months": 5,
  "VA": 10,
  "8(a)": 10,
  "HUBZone": 10,
  "SDVOSB": 30,
  "VOSB": 15,
  "WOSB": 20,
  "SBS": 20
};
const EXPECTED_READINESS_FINGERPRINT = "F19860CAF895EE8955D1514F8F04F54954DD497D0FB1F5EC800CD7F20A33D5DB";
const BLOCKED_SENDER = "info@pathways2gc.com";
const hash = value => crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
const normalizeEmail = value => String(value || "").trim().toLowerCase();

class RevenueLaunchCapacityPlanService {
  constructor(options = {}) {
    this.service = "REVENUE_LAUNCH_CAPACITY_PLAN";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.readinessPath = options.readinessPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "outbound_readiness", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "launch_capacity");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "plan.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.campaignProvider = options.campaignProvider || (async id => require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")).getCampaign(id));
    this.accountProvider = options.accountProvider || (async filters => require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")).listAccounts(filters));
  }

  preview() {
    return { ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED", providerWritesAuthorized: false, emailsSent: false, campaignsLaunched: false };
  }

  load() {
    if (!fs.existsSync(this.readinessPath)) throw new Error("Gate 22 readiness evidence is missing.");
    return JSON.parse(fs.readFileSync(this.readinessPath, "utf8").replace(/^\uFEFF/, ""));
  }

  extract(response) {
    if (Array.isArray(response)) return { items: response, next: null };
    for (const key of ["items", "accounts", "data", "results"]) {
      if (Array.isArray(response?.[key])) return { items: response[key], next: response.next_starting_after || response.nextStartingAfter || null };
    }
    throw new Error("Account inventory is invalid.");
  }

  async readAccounts() {
    const records = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < 1000; page += 1) {
      const result = this.extract(await this.accountProvider({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }));
      records.push(...result.items);
      const next = String(result.next || "").trim();
      if (!next) return records;
      if (seen.has(next)) throw new Error("Instantly account pagination returned a repeated cursor.");
      seen.add(next);
      cursor = next;
    }
    throw new Error("Instantly account pagination exceeded the safety limit.");
  }

  accountHealthy(account) {
    const status = String(account?.status ?? "").trim().toLowerCase();
    return Boolean(normalizeEmail(account?.email || account?.address || account?.account)) && !["-1", "-2", "inactive", "disabled", "error", "suspended"].includes(status);
  }

  schedule(campaign) {
    return campaign.campaign_schedule || campaign.campaignSchedule || null;
  }

  campaignSenders(campaign) {
    const values = [campaign.email_list, campaign.emailList, campaign.accounts, campaign.senders].find(Array.isArray) || [];
    return [...new Set(values.map(item => normalizeEmail(typeof item === "string" ? item : item?.email || item?.address || item?.account)).filter(Boolean))];
  }

  async build(input = {}) {
    if (input.apply !== true) return this.preview();
    if (input.live !== true) throw new Error("Explicit --live read authorization is required.");

    const readiness = this.load();
    if (readiness.ok !== true || readiness.readyToLaunch !== true || readiness.readinessFingerprint !== EXPECTED_READINESS_FINGERPRINT) throw new Error("Gate 22 readiness evidence changed.");
    if (!Array.isArray(readiness.routes) || readiness.routes.length !== 10) throw new Error("Gate 22 must contain exactly ten governed routes.");

    const accounts = await this.readAccounts();
    const accountMap = new Map(accounts.map(account => [normalizeEmail(account.email || account.address || account.account), account]));
    const campaigns = [];
    const requiredSenders = new Set();
    const blockers = [];

    for (const route of readiness.routes) {
      const live = await this.campaignProvider(route.campaignId);
      const senders = this.campaignSenders(live);
      senders.forEach(sender => requiredSenders.add(sender));
      const healthySenders = senders.filter(sender => this.accountHealthy(accountMap.get(sender)));
      const proposedDailyLimit = CAPS[route.route];
      if (!Number.isFinite(proposedDailyLimit)) blockers.push("UNKNOWN_ROUTE_CAP:" + route.route);
      if (route.ready !== undefined && route.ready !== true) blockers.push("READINESS_ROUTE_NOT_READY:" + route.route);
      if (route.paused !== true) blockers.push("CAMPAIGN_NOT_PAUSED:" + route.route);
      if (healthySenders.length !== senders.length) blockers.push("SENDER_HEALTH_FAILED:" + route.route);
      if (!senders.length) blockers.push("NO_SENDER_INBOXES:" + route.route);
      campaigns.push({
        route: route.route,
        campaignId: route.campaignId,
        paused: route.paused === true,
        senders,
        healthySenders: healthySenders.length,
        currentDailyLimit: Number(live.daily_limit ?? live.dailyLimit ?? 0),
        currentDailyMaxLeads: Number(live.daily_max_leads ?? live.dailyMaxLeads ?? 0),
        currentSchedule: this.schedule(live),
        proposedDailyLimit,
        mustRemainPaused: true
      });
    }

    const totalDailyCap = Object.values(CAPS).reduce((sum, value) => sum + value, 0);
    const healthyRequiredSenders = [...requiredSenders].filter(sender => this.accountHealthy(accountMap.get(sender)));
    const referenceSchedule = campaigns.find(item => item.route === "SBS")?.currentSchedule || campaigns.find(item => item.currentSchedule)?.currentSchedule || null;

    if (!referenceSchedule) blockers.push("VALID_PROVIDER_SCHEDULE_REQUIRED");
    if (totalDailyCap !== 180) blockers.push("CAP_CONSERVATION_FAILED");
    if (requiredSenders.size !== 9) blockers.push("NINE_UNIQUE_SENDERS_REQUIRED");
    if (healthyRequiredSenders.length !== 9) blockers.push("NINE_HEALTHY_SENDERS_REQUIRED");
    if (requiredSenders.has(BLOCKED_SENDER)) blockers.push("BLOCKED_SENDER_PRESENT:" + BLOCKED_SENDER);
    if (campaigns.some(item => !item.paused)) blockers.push("CAMPAIGN_NOT_PAUSED");

    const verifiedLeads = Number(readiness.summary?.verifiedLeads || 5654);
    const sequenceSteps = 4;
    const steadyStateNewLeadEquivalent = Math.floor(totalDailyCap / sequenceSteps);
    const estimatedSendingDaysAtFullSequence = Number((verifiedLeads / steadyStateNewLeadEquivalent).toFixed(1));
    const estimatedInitialTouchDaysIfNoFollowups = Number((verifiedLeads / totalDailyCap).toFixed(1));

    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY_LIVE_READ_ONLY",
      status: "LAUNCH_CAPACITY_PLANNED",
      generatedAt: this.generatedAt(),
      sourceReadinessFingerprint: readiness.readinessFingerprint,
      readyForCapacityApply: blockers.length === 0,
      summary: {
        campaigns: campaigns.length,
        providerAccountsRead: accounts.length,
        uniqueAssignedSenders: requiredSenders.size,
        healthyAssignedSenders: healthyRequiredSenders.length,
        totalDailyEmailCap: totalDailyCap,
        targetPerHealthyInbox: 20,
        verifiedLeads,
        sequenceSteps,
        steadyStateNewLeadEquivalent,
        estimatedInitialTouchDaysIfNoFollowups,
        estimatedSendingDaysAtFullSequence
      },
      referenceSchedule,
      campaigns,
      blockers,
      safety: {
        blockedSender: BLOCKED_SENDER,
        campaignsMustRemainPaused: true,
        noCapacityMutationAuthorized: true,
        noLaunchAuthorized: true
      },
      stopConditions: {
        bounceRatePercent: 3,
        spamComplaintCount: 1,
        senderHealthFailure: true,
        suppressionConflictCount: 1,
        unexpectedCampaignActivation: true
      },
      monitoring: { initialObservationHours: 72, reviewDaily: true },
      providerWritesAuthorized: false,
      emailsSent: false,
      campaignsChanged: false,
      campaignsLaunched: false,
      authorizationRequired: "AUTHORIZE_GATE_24_CAPACITY_CONFIGURATION_180_PER_DAY_NO_LAUNCH"
    };

    const identity = { ...report };
    delete identity.generatedAt;
    report.capacityFingerprint = hash(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, sha256: hash(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueLaunchCapacityPlanService;
module.exports.CAPS = CAPS;
