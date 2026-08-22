'use strict';

const fs = require('fs');
const path = require('path');
const ionos = require('../../CONNECTORS/IONOS/imap_readonly');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const { CATEGORIES } = ReplyIntelligenceService;

const SURFACE = new Set([
  CATEGORIES.PRICING_QUESTION,
  CATEGORIES.MEETING_INTENT,
  CATEGORIES.INTERESTED,
  CATEGORIES.REFERRAL,
  CATEGORIES.NEUTRAL_QUESTION,
  CATEGORIES.UNKNOWN
]);

function extractEmail(value = '') {
  const text = String(value || '').trim().toLowerCase();
  const angle = text.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle) return angle[1];
  const plain = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return plain ? plain[0].toLowerCase() : '';
}

function sentRecipient(item = {}) {
  const candidates = [
    item.to_address_email,
    item.to_email,
    item.to,
    item.lead,
    item.lead_email,
    item.contact,
    item.contact_email
  ];
  for (const value of candidates) {
    const email = extractEmail(value);
    if (email) return email;
  }
  return '';
}

class IonosExecutiveTriageService {
  constructor(options = {}) {
    this.root = options.root || process.env.MILES_ROOT || process.cwd();
    this.connector = options.connector || ionos;
    this.replyIntelligence = options.replyIntelligence || new ReplyIntelligenceService();
    this.instantlySource = options.instantlySource || null;
    this.lookbackDays = Math.min(Math.max(Number(options.lookbackDays || process.env.MILES_IONOS_LOOKBACK_DAYS || 7), 1), 30);
    this.maxMessages = Math.min(Math.max(Number(options.maxMessages || process.env.MILES_IONOS_MAX_MESSAGES || 100), 1), 250);
    this.instantlyMaxPages = Math.min(Math.max(Number(options.instantlyMaxPages || process.env.MILES_IONOS_INSTANTLY_MAX_PAGES || 5), 1), 20);
    this.statePath = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_triage', 'processed_uids.json');
    this.latestPath = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_triage', 'ionos_executive_triage_latest.json');
  }

  getInstantlySource() {
    if (this.instantlySource) return this.instantlySource;
    const instantly = require(path.join(this.root, 'CONNECTORS', 'INSTANTLY', 'instantly.js'));
    return { async listEmails(params) { return instantly.request('/emails', { method: 'GET', params }); } };
  }

  async loadKnownOutboundRecipients() {
    const source = this.getInstantlySource();
    const minTimestamp = new Date(Date.now() - this.lookbackDays * 86400000).toISOString();
    const recipients = new Set();
    let startingAfter = null;
    let pages = 0;
    let inspected = 0;
    do {
      const params = { limit: 100, email_type: 'sent', min_timestamp_created: minTimestamp };
      if (startingAfter) params.starting_after = startingAfter;
      const response = await source.listEmails(params);
      const items = Array.isArray(response?.items) ? response.items : Array.isArray(response) ? response : [];
      inspected += items.length;
      for (const item of items) {
        const email = sentRecipient(item);
        if (email) recipients.add(email);
      }
      pages += 1;
      startingAfter = response?.next_starting_after || null;
      if (!startingAfter || items.length === 0) break;
    } while (pages < this.instantlyMaxPages);
    return { ok: true, recipients, inspected, pages, minTimestamp, truncated: Boolean(startingAfter) };
  }

  loadState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  saveState(state) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  persist(result) {
    fs.mkdirSync(path.dirname(this.latestPath), { recursive: true });
    fs.writeFileSync(this.latestPath, JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2), 'utf8');
    return this.latestPath;
  }

  route(classification = {}) {
    return SURFACE.has(classification.category) ? 'SURFACE_EXECUTIVE' : 'AUTONOMOUS_RESOLVE';
  }

  replyEvidence(message = {}) {
    const subject = String(message.subject || '').trim();
    const inReplyTo = String(message.inReplyTo || '').trim();
    const references = String(message.references || '').trim();
    return {
      correlated: Boolean(inReplyTo || references || /^(re|fw|fwd)\s*:/i.test(subject)),
      inReplyTo: Boolean(inReplyTo),
      references: Boolean(references),
      replySubject: /^(re|fw|fwd)\s*:/i.test(subject)
    };
  }

  applyQualificationGate(classification = {}, message = {}, outboundRecipients = new Set()) {
    const threadEvidence = this.replyEvidence(message);
    const sender = extractEmail(classification.from || message.from || '');
    const knownOutboundRecipient = Boolean(sender && outboundRecipients.has(sender));
    const qualificationEvidence = {
      ...threadEvidence,
      sender,
      knownOutboundRecipient,
      qualifiedCorrelation: knownOutboundRecipient
    };
    if (!classification.qualifiedPositive || knownOutboundRecipient) {
      return { classification, evidence: qualificationEvidence, gated: false };
    }
    return {
      classification: {
        ...classification,
        qualifiedPositive: false,
        priority: 'HIGH',
        action: 'REVIEW_UNCORRELATED_INBOUND'
      },
      evidence: qualificationEvidence,
      gated: true
    };
  }

  async triageMailbox(mailbox, state, outboundRecipients, options = {}) {
    const execute = options.execute === true;
    const fetched = await this.connector.fetchRecentMessages(mailbox, {
      lookbackDays: this.lookbackDays,
      maxMessages: this.maxMessages
    });
    const prior = new Set((state[mailbox.email] || []).map(Number).filter(Number.isFinite));
    const decisions = [];
    let skippedMilesForward = 0;
    let uncorrelatedPositiveGated = 0;

    for (const message of fetched.messages || []) {
      if (message.milesExecutiveTriage) {
        skippedMilesForward += 1;
        continue;
      }
      if (prior.has(message.uid)) continue;
      const initial = this.replyIntelligence.classify(message);
      const gated = this.applyQualificationGate(initial, message, outboundRecipients);
      const classification = gated.classification;
      if (gated.gated) uncorrelatedPositiveGated += 1;
      decisions.push({
        uid: message.uid,
        id: message.id,
        from: classification.from,
        to: message.to,
        subject: classification.subject,
        category: classification.category,
        confidence: classification.confidence,
        humanReply: classification.humanReply,
        qualifiedPositive: classification.qualifiedPositive,
        action: classification.action,
        priority: classification.priority,
        route: this.route(classification),
        timestamp: classification.timestamp,
        preview: classification.preview,
        replyCorrelated: gated.evidence.correlated,
        replyEvidence: gated.evidence,
        uncorrelatedPositiveGated: gated.gated
      });
    }

    if (execute) {
      const next = [...prior, ...(fetched.messages || []).map(m => m.uid)].filter(Number.isFinite);
      state[mailbox.email] = [...new Set(next)].sort((a,b) => a-b).slice(-1000);
    }

    return {
      ok: true,
      account: mailbox.email,
      readOnlyMailbox: true,
      messagesFetched: (fetched.messages || []).length,
      newMessagesClassified: decisions.length,
      qualifiedPositive: decisions.filter(d => d.qualifiedPositive).length,
      surfaced: decisions.filter(d => d.route === 'SURFACE_EXECUTIVE').length,
      autonomousResolved: decisions.filter(d => d.route === 'AUTONOMOUS_RESOLVE').length,
      skippedMilesForward,
      uncorrelatedPositiveGated,
      decisions
    };
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const state = this.loadState();
    const accounts = [];
    const errors = [];
    let outbound;
    try {
      outbound = await this.loadKnownOutboundRecipients();
    } catch (error) {
      outbound = { ok: false, recipients: new Set(), inspected: 0, pages: 0, error: error.message };
      errors.push({ account: 'INSTANTLY_OUTBOUND_CORRELATION', error: error.message });
    }

    for (const mailbox of this.connector.mailboxConfigs()) {
      try {
        accounts.push(await this.triageMailbox(mailbox, state, outbound.recipients || new Set(), { execute }));
      } catch (error) {
        errors.push({ account: mailbox.email, error: error.message });
      }
    }

    if (execute && errors.length === 0) this.saveState(state);

    const result = {
      ok: outbound.ok === true && accounts.length > 0 && errors.length === 0 && accounts.every(a => a.ok),
      mode: execute ? 'ACTIVE_READ_ONLY_MAILBOX' : 'PLAN_ONLY',
      outboundCorrelation: {
        ok: outbound.ok === true,
        source: 'INSTANTLY_SENT_EMAIL_HISTORY',
        sentMessagesInspected: outbound.inspected || 0,
        uniqueRecipients: outbound.recipients ? outbound.recipients.size : 0,
        pages: outbound.pages || 0,
        truncated: outbound.truncated === true,
        error: outbound.error || null
      },
      accounts,
      errors,
      totals: {
        messagesFetched: accounts.reduce((n,a) => n + a.messagesFetched, 0),
        newMessagesClassified: accounts.reduce((n,a) => n + a.newMessagesClassified, 0),
        qualifiedPositive: accounts.reduce((n,a) => n + a.qualifiedPositive, 0),
        surfaced: accounts.reduce((n,a) => n + a.surfaced, 0),
        uncorrelatedPositiveGated: accounts.reduce((n,a) => n + a.uncorrelatedPositiveGated, 0)
      },
      safety: {
        mailboxReadOnly: true,
        usesExamine: true,
        usesBodyPeek: true,
        noSmtp: true,
        noMailboxMutation: true,
        localUidDedupeOnly: true,
        milesForwardLoopSuppression: true,
        qualifiedPositiveRequiresKnownInstantlyOutboundRecipient: true,
        instantlyReadOnly: true
      }
    };
    result.artifact = this.persist(result);
    return result;
  }
}

module.exports = IonosExecutiveTriageService;
module.exports.IonosExecutiveTriageService = IonosExecutiveTriageService;
module.exports.extractEmail = extractEmail;
module.exports.sentRecipient = sentRecipient;
