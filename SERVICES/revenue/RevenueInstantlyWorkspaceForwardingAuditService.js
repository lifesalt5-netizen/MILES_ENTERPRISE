"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTHORIZATION = "AUTHORIZE_GATE_23A_FULL_INSTANTLY_WORKSPACE_AND_FORWARDING_AUDIT_REPLY_TRIAGE_PLAN_ONLY";

function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value || "").trim(); }
function lower(value) { return text(value).toLowerCase(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }

class RevenueInstantlyWorkspaceForwardingAuditService {
  constructor(options = {}) {
    this.service = "REVENUE_INSTANTLY_WORKSPACE_FORWARDING_AUDIT";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.readinessPath = options.readinessPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "outbound_readiness", "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_workspace_forwarding_audit");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "manifest.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.pageDelayMs = options.pageDelayMs === undefined ? 3250 : Number(options.pageDelayMs);
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const connector = options.connector || ((options.campaignProvider && options.accountProvider && options.emailProvider)
      ? null
      : require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js")));
    this.campaignProvider = options.campaignProvider || (params => connector.listCampaigns(params));
    this.accountProvider = options.accountProvider || (params => connector.listAccounts(params));
    this.emailProvider = options.emailProvider || (params => connector.request("/emails", { method: "GET", params }));
    this.forwardingEvidenceProvider = options.forwardingEvidenceProvider || (() => null);
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      authorizationRequired: AUTHORIZATION,
      providerReadsAuthorized: false,
      providerWritesAuthorized: false,
      mailboxWritesAuthorized: false,
      repliesSent: false,
      emailsSent: false,
      campaignsChanged: false,
      campaignsLaunched: false
    };
  }

  loadReadiness() {
    if (!fs.existsSync(this.readinessPath)) throw new Error("Gate 22 readiness evidence is missing.");
    const value = JSON.parse(fs.readFileSync(this.readinessPath, "utf8").replace(/^\uFEFF/, ""));
    if (value.ok !== true || value.readyToLaunch !== true || Number(value.summary?.campaignsReady) !== 10) {
      throw new Error("Gate 22 readiness evidence is unhealthy.");
    }
    return value;
  }

  extract(response, keys) {
    if (Array.isArray(response)) return { items: response, next: null };
    for (const key of keys) {
      if (Array.isArray(response?.[key])) {
        return { items: response[key], next: response.next_starting_after || response.nextStartingAfter || response.next_cursor || response.nextCursor || null };
      }
    }
    throw new Error("Provider response does not contain an inventory array.");
  }

  async paginate(provider, keys, pageLimit = 1000) {
    const records = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < pageLimit; page += 1) {
      if (page > 0 && this.pageDelayMs > 0) await this.sleep(this.pageDelayMs);
      const response = await provider({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
      const result = this.extract(response, keys);
      records.push(...result.items);
      if (!result.items.length || !text(result.next)) return records;
      const next = text(result.next);
      if (seen.has(next)) throw new Error("Provider pagination returned a repeated cursor.");
      seen.add(next);
      cursor = next;
    }
    throw new Error("Provider pagination exceeded the safety limit.");
  }

  campaignStatus(campaign) {
    const status = lower(campaign.status ?? campaign.campaign_status);
    if (["1", "active", "running", "launched"].includes(status)) return "ACTIVE";
    if (["2", "paused"].includes(status)) return "PAUSED";
    if (["3", "completed", "finished"].includes(status)) return "COMPLETED";
    return "DRAFT";
  }

  campaignSenders(campaign) {
    const values = [campaign.email_list, campaign.emailList, campaign.accounts, campaign.senders].find(Array.isArray) || [];
    return [...new Set(values.map(item => lower(typeof item === "string" ? item : item?.email || item?.address || item?.account)).filter(Boolean))];
  }

  dailyLimit(campaign) {
    const value = Number(campaign.daily_limit ?? campaign.dailyLimit ?? campaign.campaign_daily_limit ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  forwarding(account) {
    const targets = [];
    for (const key of ["forward_to", "forwardTo", "forwarding_email", "forwardingEmail", "reply_to", "replyTo"]) {
      if (text(account?.[key])) targets.push(lower(account[key]));
    }
    return [...new Set(targets)];
  }

  classifyReply(message) {
    const subject = lower(message.subject);
    const body = lower(message.body || message.text || message.content || message.preview);
    const combined = subject + " " + body;
    if (/unsubscribe|remove me|stop emailing|do not (email|contact)|opt.?out/.test(combined)) return "UNSUBSCRIBE";
    if (/out of office|away from (my )?desk|automatic reply|auto.?reply|on vacation/.test(combined)) return "OUT_OF_OFFICE";
    if (/undeliver|delivery status|mail delivery|bounce|address not found|does not exist/.test(combined)) return "TECHNICAL";
    if (/not interested|no thanks|not a fit|do not need/.test(combined)) return "NEGATIVE";
    if (/how much|price|pricing|cost|schedule|meeting|call me|interested|tell me more|proposal/.test(combined)) return "POSITIVE_REVIEW";
    return "MANUAL_REVIEW";
  }

  isInbound(message) {
    const direction = lower(message.direction || message.type || message.email_type);
    return !direction || ["inbound", "received", "reply", "1"].includes(direction);
  }

  async audit(input = {}) {
    if (input.apply !== true) return this.plan();
    if (input.live !== true) throw new Error("Explicit --live provider-read authorization is required.");
    if (input.authorization !== AUTHORIZATION) throw new Error("Exact Gate 23A authorization is required.");

    const readiness = this.loadReadiness();
    // Instantly permits 20 requests per minute. Read inventories serially and
    // pace pagination so a large mailbox cannot burst through that limit.
    const campaigns = await this.paginate(this.campaignProvider, ["items", "campaigns", "data", "results"]);
    if (this.pageDelayMs > 0) await this.sleep(this.pageDelayMs);
    const accounts = await this.paginate(this.accountProvider, ["items", "accounts", "data", "results"]);
    if (this.pageDelayMs > 0) await this.sleep(this.pageDelayMs);
    const rawEmails = await this.paginate(this.emailProvider, ["items", "emails", "data", "results"]);
    const inbound = rawEmails.filter(item => this.isInbound(item));
    const governedIds = new Set(array(readiness.routes).map(route => text(route.campaignId)).filter(Boolean));
    const campaignInventory = campaigns.map(campaign => {
      const id = text(campaign.id || campaign.campaign_id);
      const status = this.campaignStatus(campaign);
      return {
        campaignId: id,
        name: text(campaign.name || campaign.campaign_name) || "UNNAMED",
        status,
        governed: governedIds.has(id),
        dailyLimit: this.dailyLimit(campaign),
        senders: this.campaignSenders(campaign)
      };
    });
    const active = campaignInventory.filter(item => item.status === "ACTIVE");
    const activeLegacy = active.filter(item => !item.governed);
    const accountInventory = accounts.map(account => ({
      email: lower(account.email || account.address || account.account),
      status: text(account.status),
      forwardingTargetsVisibleToInstantly: this.forwarding(account)
    }));
    const visibleForwarding = accountInventory.flatMap(item => item.forwardingTargetsVisibleToInstantly.map(target => ({ source: item.email, target })));
    const suppliedForwardingEvidence = await this.forwardingEvidenceProvider();
    const ionosEvidencePresent = Boolean(suppliedForwardingEvidence?.ok === true && Array.isArray(suppliedForwardingEvidence.rules));
    const forwardingRules = ionosEvidencePresent ? suppliedForwardingEvidence.rules : visibleForwarding;

    const triage = inbound.map(message => ({
      messageId: text(message.id || message.email_id),
      from: lower(message.from_address_email || message.from || message.sender),
      subject: text(message.subject).slice(0, 180),
      receivedAt: text(message.timestamp || message.created_at || message.received_at),
      classification: this.classifyReply(message)
    }));
    const triageCounts = {};
    for (const item of triage) triageCounts[item.classification] = (triageCounts[item.classification] || 0) + 1;
    const blockers = [];
    if (activeLegacy.length) blockers.push("ACTIVE_LEGACY_CAMPAIGNS_CONSUME_CAPACITY");
    if (!ionosEvidencePresent) blockers.push("IONOS_FORWARDING_EVIDENCE_REQUIRED");
    if (triageCounts.UNSUBSCRIBE) blockers.push("UNSUBSCRIBE_SUPPRESSION_RECONCILIATION_REQUIRED");
    if (triageCounts.POSITIVE_REVIEW || triageCounts.MANUAL_REVIEW) blockers.push("REPLY_TRIAGE_REQUIRED");

    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY_LIVE_READ_ONLY",
      status: "FULL_WORKSPACE_AND_FORWARDING_AUDITED",
      generatedAt: this.generatedAt(),
      authorization: AUTHORIZATION,
      sourceReadinessFingerprint: readiness.readinessFingerprint,
      safeForGate23CapacityApply: blockers.length === 0,
      summary: {
        campaignsRead: campaignInventory.length,
        governedCampaignsFound: campaignInventory.filter(item => item.governed).length,
        activeCampaigns: active.length,
        activeLegacyCampaigns: activeLegacy.length,
        activeDailyLimit: active.reduce((sum, item) => sum + item.dailyLimit, 0),
        accountsRead: accountInventory.length,
        forwardingRulesConfirmed: forwardingRules.length,
        ionosForwardingEvidencePresent: ionosEvidencePresent,
        inboundMessagesRead: inbound.length,
        repliesRequiringReview: (triageCounts.POSITIVE_REVIEW || 0) + (triageCounts.MANUAL_REVIEW || 0)
      },
      blockers,
      campaigns: campaignInventory,
      activeLegacyCampaigns: activeLegacy,
      accounts: accountInventory,
      forwardingAudit: {
        ok: ionosEvidencePresent,
        evidenceSource: ionosEvidencePresent ? "IONOS_ADMIN_EXPORT" : "INSTANTLY_ACCOUNT_FIELDS_ONLY",
        blanketForwardingToPrimaryDetected: forwardingRules.some(rule => lower(rule.target) === "kevin@pathways2gc.com"),
        rules: forwardingRules,
        requiredRemediation: "Retain mail in each outreach inbox for Instantly; escalate only positive or meeting-ready replies to kevin@pathways2gc.com."
      },
      replyTriage: { counts: triageCounts, items: triage },
      proposedActions: [
        "PAUSE_OR_CAP_ACTIVE_LEGACY_CAMPAIGNS_BEFORE_NEW_LAUNCH",
        "EXPORT_AND_AUDIT_IONOS_FORWARDING_AND_CATCH_ALL_RULES",
        "REMOVE_BLANKET_FORWARDING_ONLY_AFTER_EVIDENCE_BACKUP",
        "SUPPRESS_UNSUBSCRIBES_NEGATIVES_AND_TECHNICAL_FAILURES",
        "ESCALATE_POSITIVE_AND_MEETING_READY_REPLIES_TO_PRIMARY_BUSINESS_INBOX",
        "RECALCULATE_NINE_INBOX_CAPACITY_AFTER_LEGACY_LOAD"
      ],
      providerReadsPerformed: true,
      providerWritesAuthorized: false,
      mailboxWritesAuthorized: false,
      repliesSent: false,
      emailsSent: false,
      campaignsChanged: false,
      campaignsLaunched: false
    };
    const identity = { ...report };
    delete identity.generatedAt;
    report.auditFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueInstantlyWorkspaceForwardingAuditService;
module.exports.AUTHORIZATION = AUTHORIZATION;
