"use strict";

const { google } = require("googleapis");
const accountManager = require("../../CONNECTORS/GOOGLE/account_manager");
const ReplyIntelligenceService = require("./ReplyIntelligenceService");
const { CATEGORIES } = ReplyIntelligenceService;

const DEFAULT_EXECUTIVE_INBOX = "kevin@pathways2gc.com";
const DEFAULT_BUSINESS_DOMAINS = [
  "pathways2gc.com",
  "pathwaysgovcon.com",
  "pathwaysgsa.com",
  "pathwaysgov.com"
];
const SURFACE = new Set([
  CATEGORIES.PRICING_QUESTION,
  CATEGORIES.MEETING_INTENT,
  CATEGORIES.INTERESTED,
  CATEGORIES.REFERRAL,
  CATEGORIES.NEUTRAL_QUESTION,
  CATEGORIES.UNKNOWN
]);

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(value) {
  const match = String(value || "").trim().toLowerCase().match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  return match ? match[1] : String(value || "").trim().toLowerCase();
}

function emailDomain(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "";
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function headerMap(headers = []) {
  const result = {};
  for (const header of headers || []) {
    const key = String(header?.name || "").toLowerCase();
    if (key) result[key] = String(header?.value || "");
  }
  return result;
}

function payloadBody(payload = {}) {
  if (payload?.mimeType === "text/plain" && payload?.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload?.parts || []) {
    const text = payloadBody(part);
    if (text) return text;
  }
  if (payload?.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function normalizeMessage(message = {}, account = null) {
  const headers = headerMap(message?.payload?.headers || []);
  return {
    id: message.id || "",
    thread_id: message.threadId || "",
    from: headers.from || "",
    to: headers.to || account || "",
    subject: headers.subject || "",
    text: payloadBody(message.payload || {}) || message.snippet || "",
    timestamp: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString()
  };
}

function encodeRawEmail({ to, from, subject, body, sourceMessageId }) {
  const cleanSubject = String(subject || "(no subject)").replace(/[\r\n]+/g, " ").slice(0, 180);
  const cleanTo = String(to || "").replace(/[\r\n]+/g, "");
  const cleanFrom = String(from || "").replace(/[\r\n]+/g, "");
  const raw = [
    `To: ${cleanTo}`,
    `From: ${cleanFrom}`,
    `Subject: ${cleanSubject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "X-MILES-Executive-Triage: true",
    `X-MILES-Source-Message-Id: ${String(sourceMessageId || "").replace(/[\r\n]+/g, "")}`,
    "",
    String(body || "")
  ].join("\r\n");
  return Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

class GmailExecutiveTriageService {
  constructor(options = {}) {
    this.accountManager = options.accountManager || accountManager;
    this.google = options.google || google;
    this.replyIntelligence = options.replyIntelligence || new ReplyIntelligenceService();
    this.destination = options.destination || process.env.MILES_EXECUTIVE_INBOX || DEFAULT_EXECUTIVE_INBOX;
    this.maxResults = Math.min(Math.max(Number(options.maxResults || 100), 1), 500);
    const configuredDomains = options.businessDomains || parseCsv(process.env.MILES_GMAIL_BUSINESS_DOMAINS);
    const configuredAccounts = options.accountAllowlist || parseCsv(process.env.MILES_GMAIL_TRIAGE_ACCOUNT_ALLOWLIST);
    this.businessDomains = new Set((configuredDomains.length ? configuredDomains : DEFAULT_BUSINESS_DOMAINS).map(item => String(item).toLowerCase()));
    this.accountAllowlist = new Set(configuredAccounts.map(item => String(item).toLowerCase()));
  }

  route(classification = {}) {
    if (SURFACE.has(classification.category)) return "SURFACE_EXECUTIVE";
    return "AUTONOMOUS_RESOLVE";
  }

  accountScope(account = {}) {
    const email = normalizeEmail(account.email || "");
    const accountKey = String(account.accountKey || "").trim().toLowerCase();
    const domain = emailDomain(email);
    const explicitlyAllowed = this.accountAllowlist.has(email) || this.accountAllowlist.has(accountKey);
    const approvedDomain = Boolean(domain && this.businessDomains.has(domain));
    if (explicitlyAllowed || approvedDomain) {
      return {
        eligible: true,
        scope: "BUSINESS_TRIAGE",
        reason: explicitlyAllowed ? "EXPLICIT_ACCOUNT_ALLOWLIST" : "APPROVED_BUSINESS_DOMAIN",
        email,
        domain
      };
    }
    return {
      eligible: false,
      scope: "OUT_OF_BUSINESS_SCOPE",
      reason: "BUSINESS_TRIAGE_ACCOUNT_NOT_APPROVED",
      email,
      domain
    };
  }

  async gmailForAccount(accountKey) {
    const auth = await this.accountManager.getAuthClientForAccount(accountKey);
    return this.google.gmail({ version: "v1", auth });
  }

  async autoForwardingStatus(gmail) {
    try {
      const response = await gmail.users.settings.getAutoForwarding({ userId: "me" });
      return {
        readable: true,
        enabled: response?.data?.enabled === true,
        emailAddress: response?.data?.emailAddress || null,
        disposition: response?.data?.disposition || null
      };
    } catch (error) {
      return { readable: false, enabled: null, error: error.message };
    }
  }

  async ensureLabel(gmail, name) {
    const listed = await gmail.users.labels.list({ userId: "me" });
    const existing = (listed?.data?.labels || []).find(label => label.name === name);
    if (existing) return existing.id;
    const created = await gmail.users.labels.create({
      userId: "me",
      requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" }
    });
    return created.data.id;
  }

  async forwardToExecutive(gmail, sourceAccount, normalized, classification) {
    const body = [
      `MILES classification: ${classification.category}`,
      `Priority: ${classification.priority}`,
      `Original sender: ${normalized.from}`,
      `Original recipient: ${normalized.to || sourceAccount}`,
      `Original subject: ${normalized.subject}`,
      "",
      normalized.text || classification.preview || ""
    ].join("\n");
    const raw = encodeRawEmail({
      to: this.destination,
      from: sourceAccount,
      subject: `[MILES ${classification.category}] Fwd: ${normalized.subject || "(no subject)"}`,
      body,
      sourceMessageId: normalized.id
    });
    return gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  }

  async triageAccount(account, options = {}) {
    const execute = options.execute === true;
    const scope = this.accountScope(account);
    const result = {
      account: account.email || account.accountKey,
      accountKey: account.accountKey,
      execute,
      destination: this.destination,
      scope: scope.scope,
      scopeReason: scope.reason,
      skipped: !scope.eligible,
      autoForwarding: null,
      messagesInspected: 0,
      surfaced: 0,
      autonomousResolved: 0,
      forwarded: 0,
      archived: 0,
      errors: [],
      decisions: [],
      blocker: null
    };

    // Safety boundary: this business/revenue triage service must not read, label,
    // archive, forward, or otherwise touch a personal/unapproved Gmail mailbox.
    if (!scope.eligible) {
      result.ok = true;
      return result;
    }

    const gmail = await this.gmailForAccount(account.accountKey);
    const autoForwarding = await this.autoForwardingStatus(gmail);
    result.autoForwarding = autoForwarding;
    const mutationsEnabled = truthy(process.env.MILES_GOOGLE_INBOX_MUTATIONS);
    const forwardingEnabled = truthy(process.env.MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED);

    if (!autoForwarding.readable) {
      result.blocker = "GMAIL_AUTO_FORWARDING_STATUS_UNREADABLE";
      return result;
    }
    if (autoForwarding.enabled) {
      result.blocker = "LEGACY_GMAIL_AUTO_FORWARDING_ENABLED";
      return result;
    }
    if (execute && (!mutationsEnabled || !forwardingEnabled)) {
      result.blocker = "GMAIL_EXECUTIVE_TRIAGE_WRITE_GATES_DISABLED";
      return result;
    }

    const listed = await gmail.users.messages.list({
      userId: "me",
      maxResults: this.maxResults,
      q: "in:inbox newer_than:7d -label:MILES/PROCESSED"
    });
    const refs = listed?.data?.messages || [];

    let labels = null;
    if (execute) {
      labels = {
        processed: await this.ensureLabel(gmail, "MILES/PROCESSED"),
        surfaced: await this.ensureLabel(gmail, "MILES/SURFACED"),
        autonomous: await this.ensureLabel(gmail, "MILES/AUTONOMOUS")
      };
    }

    for (const ref of refs) {
      try {
        const fetched = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" });
        const normalized = normalizeMessage(fetched.data || {}, result.account);
        const classification = this.replyIntelligence.classify(normalized);
        const route = this.route(classification);
        result.messagesInspected += 1;
        if (route === "SURFACE_EXECUTIVE") result.surfaced += 1;
        else result.autonomousResolved += 1;

        const decision = {
          id: normalized.id,
          from: classification.from,
          subject: classification.subject,
          category: classification.category,
          confidence: classification.confidence,
          route,
          forwarded: false,
          archived: false
        };

        if (execute) {
          if (route === "SURFACE_EXECUTIVE") {
            await this.forwardToExecutive(gmail, result.account, normalized, classification);
            result.forwarded += 1;
            decision.forwarded = true;
          }
          await gmail.users.messages.modify({
            userId: "me",
            id: normalized.id,
            requestBody: {
              addLabelIds: [labels.processed, route === "SURFACE_EXECUTIVE" ? labels.surfaced : labels.autonomous],
              removeLabelIds: ["INBOX"]
            }
          });
          result.archived += 1;
          decision.archived = true;
        }
        result.decisions.push(decision);
      } catch (error) {
        result.errors.push({ id: ref.id, error: error.message });
      }
    }

    result.ok = !result.blocker && result.errors.length === 0;
    return result;
  }

  async run(options = {}) {
    const accounts = this.accountManager.listAccounts().filter(account => account.valid);
    const results = [];
    for (const account of accounts) results.push(await this.triageAccount(account, options));
    const eligible = results.filter(item => item.scope === "BUSINESS_TRIAGE");
    const skipped = results.filter(item => item.scope === "OUT_OF_BUSINESS_SCOPE");
    return {
      ok: results.length > 0 && results.every(item => item.ok === true),
      mode: options.execute === true ? "EXECUTE" : "PLAN_ONLY",
      destination: this.destination,
      accounts: results,
      eligibleBusinessAccounts: eligible.length,
      skippedOutOfBusinessScope: skipped.length,
      blockers: results.filter(item => item.blocker).map(item => ({ account: item.account, blocker: item.blocker, autoForwarding: item.autoForwarding })),
      safety: {
        requiresLegacyAutoForwardingDisabled: true,
        mutationsGate: "MILES_GOOGLE_INBOX_MUTATIONS",
        executiveForwardGate: "MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED",
        neverArchiveBeforeRequiredForwardSucceeds: true,
        businessScopeOnly: true,
        outOfScopeAccountsAreNotReadOrMutated: true,
        businessDomains: Array.from(this.businessDomains),
        explicitAllowlistConfigured: this.accountAllowlist.size > 0
      }
    };
  }
}

module.exports = GmailExecutiveTriageService;
module.exports.GmailExecutiveTriageService = GmailExecutiveTriageService;
module.exports.normalizeMessage = normalizeMessage;
module.exports.payloadBody = payloadBody;
module.exports.encodeRawEmail = encodeRawEmail;
module.exports.normalizeEmail = normalizeEmail;
module.exports.emailDomain = emailDomain;
module.exports.DEFAULT_BUSINESS_DOMAINS = DEFAULT_BUSINESS_DOMAINS;
