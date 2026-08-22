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

class IonosExecutiveTriageService {
  constructor(options = {}) {
    this.root = options.root || process.env.MILES_ROOT || process.cwd();
    this.connector = options.connector || ionos;
    this.replyIntelligence = options.replyIntelligence || new ReplyIntelligenceService();
    this.lookbackDays = Math.min(Math.max(Number(options.lookbackDays || process.env.MILES_IONOS_LOOKBACK_DAYS || 7), 1), 30);
    this.maxMessages = Math.min(Math.max(Number(options.maxMessages || process.env.MILES_IONOS_MAX_MESSAGES || 100), 1), 250);
    this.statePath = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_triage', 'processed_uids.json');
    this.latestPath = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_triage', 'ionos_executive_triage_latest.json');
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

  applyReplyCorrelationGate(classification = {}, message = {}) {
    const evidence = this.replyEvidence(message);
    if (!classification.qualifiedPositive || evidence.correlated) {
      return { classification, evidence, gated: false };
    }
    return {
      classification: {
        ...classification,
        qualifiedPositive: false,
        priority: 'HIGH',
        action: 'REVIEW_UNCORRELATED_INBOUND'
      },
      evidence,
      gated: true
    };
  }

  async triageMailbox(mailbox, state, options = {}) {
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
      const gated = this.applyReplyCorrelationGate(initial, message);
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

    for (const mailbox of this.connector.mailboxConfigs()) {
      try {
        accounts.push(await this.triageMailbox(mailbox, state, { execute }));
      } catch (error) {
        errors.push({ account: mailbox.email, error: error.message });
      }
    }

    if (execute && errors.length === 0) this.saveState(state);

    const result = {
      ok: accounts.length > 0 && errors.length === 0 && accounts.every(a => a.ok),
      mode: execute ? 'ACTIVE_READ_ONLY_MAILBOX' : 'PLAN_ONLY',
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
        qualifiedPositiveRequiresReplyCorrelation: true
      }
    };
    result.artifact = this.persist(result);
    return result;
  }
}

module.exports = IonosExecutiveTriageService;
module.exports.IonosExecutiveTriageService = IonosExecutiveTriageService;
