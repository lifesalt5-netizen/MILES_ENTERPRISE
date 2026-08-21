"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { inspectCampaignSchedule, inspectSenderCapacity } = require("./OutboundSendingGovernance");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function email(value) { return String(value || "").trim().toLowerCase(); }
function validEmail(value) { return /^\S+@\S+\.\S+$/.test(email(value)); }

class RevenueOutboundReadinessAuditService {
  constructor(options = {}) {
    this.service = "REVENUE_OUTBOUND_READINESS_AUDIT";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.configurationPath = options.configurationPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_configuration_apply", "manifest.json");
    this.configurationPlanPath = options.configurationPlanPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_configuration", "plan.json");
    this.uploadPath = options.uploadPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "all_segment_governed_upload", "manifest.json");
    this.masterPath = options.masterPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_segment_activation", "verified_segment_master.jsonl");
    this.riskyPath = options.riskyPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results", "risky_blocked.jsonl");
    this.invalidPath = options.invalidPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results", "invalid_do_not_mail.jsonl");
    this.replyRoutingPath = options.replyRoutingPath || path.join(this.rootDir, "runtime", "instantly_coo", "reply_routing.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "outbound_readiness");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.campaignProvider = options.campaignProvider || (async id => require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")).getCampaign(id));
    this.accountProvider = options.accountProvider || (async filters => require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")).listAccounts(filters));
  }

  plan() {
    return { ok:true, service:this.service, mode:"PLAN_ONLY", status:"PLANNED", providerReadsAuthorized:false, providerWritesAuthorized:false, emailsSent:false, campaignsChanged:false, campaignsLaunched:false };
  }

  loadJson(filePath, required = true) {
    if (!fs.existsSync(filePath)) {
      if (!required) return null;
      throw new Error("Required readiness evidence is missing: " + filePath);
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required readiness inventory is missing: " + filePath);
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  extract(response, keys) {
    if (Array.isArray(response)) return { items:response, next:null };
    for (const key of keys) if (Array.isArray(response?.[key])) return { items:response[key], next:response.next_starting_after || response.nextStartingAfter || null };
    throw new Error("Instantly provider response does not contain an inventory array.");
  }

  async readAccounts() {
    const records = [], seen = new Set();
    let cursor = null;
    for (let page = 0; page < 1000; page += 1) {
      const result = this.extract(await this.accountProvider({ limit:100, ...(cursor ? { starting_after:cursor } : {}) }), ["items","accounts","data","results"]);
      if (!result.items.length) return records;
      records.push(...result.items);
      const next = String(result.next || "").trim();
      if (!next) return records;
      if (seen.has(next)) throw new Error("Instantly account pagination returned a repeated cursor.");
      seen.add(next); cursor = next;
    }
    throw new Error("Instantly account pagination exceeded the safety limit.");
  }

  senderEmails(campaign) {
    const values = [campaign.email_list, campaign.emailList, campaign.accounts, campaign.senders].find(Array.isArray) || [];
    return [...new Set(values.map(item => email(typeof item === "string" ? item : item?.email || item?.address || item?.account)).filter(Boolean))];
  }

  messageSteps(campaign) {
    const found = [];
    const visit = value => {
      if (!value || typeof value !== "object") return;
      if (!Array.isArray(value) && String(value.subject || "").trim() && String(value.body || value.content || value.email_body || "").trim()) found.push(value);
      for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
    };
    visit(campaign.sequences || campaign.sequence || campaign.steps || []);
    return found.length;
  }

  paused(campaign) {
    const status = String(campaign.status ?? campaign.campaign_status ?? "").trim().toLowerCase();
    return !["1","active","running","launched"].includes(status);
  }

  boolean(campaign, names, expected) {
    for (const name of names) if (campaign[name] !== undefined) return campaign[name] === expected;
    return false;
  }

  accountHealthy(account) {
    const status = String(account?.status ?? "").trim().toLowerCase();
    return Boolean(email(account?.email || account?.address || account?.account)) && !["-1","-2","inactive","disabled","error","suspended"].includes(status);
  }

  async audit(input = {}) {
    if (input.apply !== true) return this.plan();
    if (input.live !== true) throw new Error("Explicit --live read authorization is required.");

    const configuration = this.loadJson(this.configurationPath);
    const configurationPlan = this.loadJson(this.configurationPlanPath);
    const upload = this.loadJson(this.uploadPath);
    if (configuration.ok !== true || configuration.status !== "SEGMENT_CONFIGURATION_COMPLETED" || !Array.isArray(configuration.routes) || !configuration.routes.length) throw new Error("Configuration evidence is unhealthy.");
    if (configurationPlan.ok !== true || configurationPlan.status !== "ALL_SEGMENT_CONFIGURATION_PLANNED" || !Array.isArray(configurationPlan.routes) || !configurationPlan.routes.length) throw new Error("Configuration plan is unhealthy.");
    if (upload.ok !== true || upload.status !== "UPLOAD_COMPLETED") throw new Error("Upload evidence is unhealthy.");
    if (upload.uploadFingerprint && !/^[A-F0-9]{64}$/i.test(String(upload.uploadFingerprint))) throw new Error("Upload fingerprint is malformed.");
    if (Number(upload.summary?.uploaded ?? 0) < 0) throw new Error("Uploaded lead count is invalid.");

    const plannedByRoute = new Map(configurationPlan.routes.map(route => [route.route, route]));
    const master = this.loadJsonl(this.masterPath);
    const risky = new Set(this.loadJsonl(this.riskyPath).map(item => email(item.email)).filter(Boolean));
    const invalid = new Set(this.loadJsonl(this.invalidPath).map(item => email(item.email)).filter(Boolean));
    const masterEmails = master.map(item => email(item.email));
    if (!master.length) throw new Error("Verified master is empty.");
    if (masterEmails.some(value => !validEmail(value))) throw new Error("Verified master contains invalid or missing emails.");
    if (new Set(masterEmails).size !== master.length) throw new Error("Verified master contains duplicate emails.");
    const suppressionConflicts = masterEmails.filter(value => risky.has(value) || invalid.has(value));
    const replyRouting = this.loadJson(this.replyRoutingPath, false);

    const accounts = await this.readAccounts();
    const accountMap = new Map(accounts.map(item => [email(item.email || item.address || item.account), item]));
    const requiredSenders = new Set();
    const routes = [];

    for (const configured of configuration.routes) {
      const routeName = configured.route;
      const campaignId = String(configured.campaignId || plannedByRoute.get(routeName)?.currentCampaignId || "").trim();
      if (!campaignId) throw new Error("Configured route is missing a campaign ID: " + routeName);
      const campaign = await this.campaignProvider(campaignId);
      const senders = this.senderEmails(campaign);
      senders.forEach(value => requiredSenders.add(value));
      const healthySenders = senders.filter(value => this.accountHealthy(accountMap.get(value) || {}));
      const steps = this.messageSteps(campaign);
      const scheduleAudit = inspectCampaignSchedule(campaign);
      const senderCapacityAudit = inspectSenderCapacity(campaign, senders.length);
      const blockers = [];
      if (!this.paused(campaign)) blockers.push("CAMPAIGN_NOT_PAUSED");
      if (steps < 1) blockers.push("SEQUENCE_REQUIRED");
      if (!senders.length) blockers.push("NO_SENDER_INBOXES");
      if (healthySenders.length !== senders.length) blockers.push("SENDER_HEALTH_FAILED");
      if (!this.boolean(campaign, ["stop_on_reply","stopOnReply"], true)) blockers.push("STOP_ON_REPLY_REQUIRED");
      if (!this.boolean(campaign, ["stop_on_auto_reply","stopOnAutoReply"], true)) blockers.push("STOP_ON_AUTO_REPLY_REQUIRED");
      if (!this.boolean(campaign, ["allow_risky_contacts","allowRiskyContacts"], false)) blockers.push("RISKY_CONTACT_BLOCK_REQUIRED");
      if (!this.boolean(campaign, ["disable_bounce_protect","disableBounceProtect"], false)) blockers.push("BOUNCE_PROTECTION_REQUIRED");
      if (!scheduleAudit.compliant) blockers.push("SEND_WINDOW_POLICY_FAILED", ...scheduleAudit.violations);
      if (!senderCapacityAudit.compliant) blockers.push("SENDER_CAPACITY_POLICY_FAILED", ...senderCapacityAudit.violations);
      routes.push({ route:routeName, campaignId, paused:this.paused(campaign), messageSteps:steps, senders, healthySenders:healthySenders.length, scheduleAudit, senderCapacityAudit, blockers:[...new Set(blockers)], ready:blockers.length===0 });
    }

    const replyRoutingHealthy = Boolean(replyRouting?.ok === true && replyRouting?.positive && replyRouting?.negative && replyRouting?.neutral && replyRouting?.technical && replyRouting?.outOfOffice);
    const globalBlockers = [];
    if (suppressionConflicts.length) globalBlockers.push("VERIFIED_SUPPRESSION_CONFLICTS");
    if (!requiredSenders.size) globalBlockers.push("NO_REQUIRED_SENDERS_OBSERVED");
    if (!replyRoutingHealthy) globalBlockers.push("REPLY_ROUTING_EVIDENCE_REQUIRED");
    const ready = globalBlockers.length === 0 && routes.every(route => route.ready);

    const report = {
      ok:true, service:this.service, mode:"APPLY_LIVE_READ_ONLY", status:"OUTBOUND_READINESS_AUDITED", generatedAt:this.generatedAt(),
      readyToLaunch:ready,
      sourceConfigurationFingerprint:configuration.configurationApplyFingerprint || null,
      sourceUploadFingerprint:upload.uploadFingerprint || null,
      sourceEvidence:{ configuredRoutes:configuration.routes.length, plannedRoutes:configurationPlan.routes.length, uploaded:Number(upload.summary?.uploaded ?? 0), verifiedMaster:master.length, providerAccounts:accounts.length },
      summary:{ campaignsAudited:routes.length, campaignsReady:routes.filter(route=>route.ready).length, campaignsBlocked:routes.filter(route=>!route.ready).length, verifiedLeads:master.length, uniqueSenders:requiredSenders.size, healthyProviderAccounts:accounts.filter(item=>this.accountHealthy(item)).length, suppressionConflicts:suppressionConflicts.length, replyRoutingHealthy, sendWindowCompliant:routes.filter(route=>route.scheduleAudit.compliant).length, senderCapacityCompliant:routes.filter(route=>route.senderCapacityAudit.compliant).length },
      suppression:{ ok:suppressionConflicts.length===0, riskyBlocked:risky.size, doNotMail:invalid.size, conflicts:suppressionConflicts.length },
      replyRouting:{ ok:replyRoutingHealthy, evidencePath:this.replyRoutingPath },
      globalBlockers, routes,
      providerReadsPerformed:true, providerWritesAuthorized:false, emailsSent:false, campaignsChanged:false, campaignsLaunched:false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.readinessFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot, { recursive:true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath:this.outputPath, bytes:fs.statSync(this.outputPath).size, sha256:sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueOutboundReadinessAuditService;
module.exports.RevenueOutboundReadinessAuditService = RevenueOutboundReadinessAuditService;
