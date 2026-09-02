'use strict';

const fs = require('fs');
const path = require('path');
const readonly = require('../../CONNECTORS/IONOS/imap_readonly');
const governed = require('../../CONNECTORS/IONOS/imap_governed');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const P2GCCustomerDeliveryService = require('../customer/P2GCCustomerDeliveryService');
const IonosInboxCleanupService = require('./IonosInboxCleanupService');
const { CATEGORIES } = ReplyIntelligenceService;
const helpers = IonosInboxCleanupService.helpers;

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function safeFolderFor(classification = {}, message = {}, clients = new Set()) {
  if (helpers.ebuyNotice(message)) return 'MILES-GSA-EBUY';
  if (helpers.forwardedMilesNoise(message)) return 'MILES-FORWARDED';
  if (helpers.billingNotice(message)) return 'MILES-BILLING';
  if (classification.category === CATEGORIES.BOUNCE_TECHNICAL) return 'MILES-BOUNCE';
  if (helpers.knownColdOutreachMarker(message)) return 'MILES-JUNK';

  if (helpers.strongAutomatedOrBulkMail(message)) {
    if (helpers.systemNoise(message) || helpers.transactionalSystemNotice(message)) return 'MILES-SYSTEM';
    return 'MILES-JUNK';
  }

  const actionable = helpers.actionableHumanMail(classification, message, clients);
  if (actionable.keep) return null;
  if (helpers.systemNoise(message)) return 'MILES-SYSTEM';
  if (helpers.obviousVendorJunk(message)) return 'MILES-JUNK';

  switch (classification.category) {
    case CATEGORIES.OOO: return 'MILES-OOO';
    case CATEGORIES.AUTO_REPLY: return 'MILES-AUTO';
    case CATEGORIES.INBOUND_SOLICITATION_SPAM: return 'MILES-JUNK';
    case CATEGORIES.BOUNCE_TECHNICAL: return 'MILES-BOUNCE';
    case CATEGORIES.NEGATIVE:
    case CATEGORIES.UNSUBSCRIBE: return 'MILES-CLOSED';
    case CATEGORIES.NOT_NOW: return 'MILES-NURTURE';
    default: return null;
  }
}

class IonosInboxHygieneProductionLoopService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.connector = options.connector || readonly;
    this.governed = options.governed || governed;
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.customerService = options.customerService || P2GCCustomerDeliveryService;
    this.intervalMs = Number(options.intervalMs || process.env.P2GC_IONOS_HYGIENE_INTERVAL_MS || 5 * 60 * 1000);
    this.enabled = options.enabled !== undefined ? options.enabled : truthy(process.env.MILES_IONOS_HYGIENE_ENABLED, true);
    this.execute = options.execute !== undefined ? options.execute : truthy(process.env.MILES_IONOS_HYGIENE_EXECUTE, true);
    this.maxMessages = Math.min(Math.max(Number(options.maxMessages || process.env.MILES_IONOS_HYGIENE_MAX || 1000), 1), 5000);
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_hygiene', 'ionos_inbox_hygiene_latest.json');
    this.timer = null;
    this.running = false;
    this.lastResult = null;
  }

  persist(result) {
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    const payload = {
      ...result,
      generatedAt: new Date().toISOString(),
      producer: {
        pid: process.pid,
        runtimeName: process.env.MILES_RUNTIME_NAME || null,
        runtimeGeneration: process.env.MILES_RUNTIME_GENERATION || null,
        runtimeGuardPid: process.env.MILES_RUNTIME_GUARD_PID || null,
        cwd: process.cwd()
      }
    };
    fs.writeFileSync(this.output, JSON.stringify(payload, null, 2), 'utf8');
    return this.output;
  }

  async allUids(mailbox) {
    const searched = await this.connector.connectAndRun({ ...mailbox, commands: ['UID SEARCH ALL'] });
    return this.connector.searchUids(searched.extra?.[0]?.lines || []).slice(-this.maxMessages);
  }

  async fetchByUids(mailbox, uids) {
    const messages = [];
    for (const ids of chunk(uids, 100)) {
      const fetched = await this.connector.connectAndRun({ ...mailbox, commands: [`UID FETCH ${ids.join(',')} (UID BODY.PEEK[]<0.16384>)`] });
      messages.push(...this.connector.parseFetchedMessages(fetched.extra?.[0]?.lines || [], mailbox.email));
    }
    return messages;
  }

  classifyMessages(messages) {
    const clients = helpers.activeClientEmails(this.customerService);
    const routed = new Map();
    const kept = [];
    const decisions = [];
    for (const message of messages) {
      const classification = this.classifier.classify(message);
      const folder = safeFolderFor(classification, message, clients);
      decisions.push({
        uid: message.uid,
        from: message.from,
        subject: message.subject,
        category: classification.category,
        route: folder || 'KEEP_INBOX_UNCERTAIN_OR_ACTIONABLE'
      });
      if (!folder) kept.push(message.uid);
      else {
        if (!routed.has(folder)) routed.set(folder, []);
        routed.get(folder).push(message.uid);
      }
    }
    return { routed, kept, decisions };
  }

  async runMailbox(mailbox) {
    const uids = await this.allUids(mailbox);
    const messages = await this.fetchByUids(mailbox, uids);
    const before = this.classifyMessages(messages);
    const moves = [];

    for (const [folder, ids] of before.routed.entries()) {
      if (!this.execute) {
        moves.push({ ok: true, planned: true, folder, wouldMove: ids.length, moved: 0, destructiveDeleteUsed: false });
        continue;
      }
      for (const idsBatch of chunk(ids, 200)) {
        moves.push(await this.governed.moveUidsForHygiene(mailbox, idsBatch, folder));
      }
    }

    let verification = null;
    if (this.execute) {
      await sleep(500);
      const remainingUids = await this.allUids(mailbox);
      const remainingMessages = await this.fetchByUids(mailbox, remainingUids);
      const after = this.classifyMessages(remainingMessages);
      verification = {
        inboxAfter: remainingMessages.length,
        remainingHighConfidenceRoutableNoise: [...after.routed.values()].reduce((n, ids) => n + ids.length, 0),
        keptUncertainOrActionable: after.kept.length
      };
    }

    const moveOk = moves.every(item => item.ok !== false);
    const verified = !this.execute || verification?.remainingHighConfidenceRoutableNoise === 0;
    return {
      ok: moveOk && verified,
      account: mailbox.email,
      scanned: messages.length,
      routedHighConfidenceNoise: [...before.routed.values()].reduce((n, ids) => n + ids.length, 0),
      keptUncertainOrActionable: before.kept.length,
      folders: Object.fromEntries([...before.routed.entries()].map(([name, ids]) => [name, ids.length])),
      moves,
      verification,
      decisions: before.decisions
    };
  }

  async runOnce() {
    if (!this.enabled) {
      const result = { ok: false, status: 'DISABLED', enabled: false, execute: this.execute, blocker: 'IONOS_CONTINUOUS_HYGIENE_DISABLED' };
      result.artifact = this.persist(result);
      this.lastResult = result;
      return result;
    }
    if (this.running) return this.lastResult || { ok: false, status: 'ALREADY_RUNNING' };
    this.running = true;
    try {
      const accounts = [];
      const errors = [];
      for (const mailbox of this.connector.mailboxConfigs()) {
        try { accounts.push(await this.runMailbox(mailbox)); }
        catch (error) { errors.push({ account: mailbox.email, error: error.message }); }
      }
      const result = {
        ok: accounts.length > 0 && errors.length === 0 && accounts.every(item => item.ok),
        status: errors.length === 0 && accounts.every(item => item.ok) ? (this.execute ? 'ACTIVE' : 'PLAN_ONLY') : 'BLOCKED',
        enabled: true,
        execute: this.execute,
        accounts,
        errors,
        totals: {
          scanned: accounts.reduce((n, item) => n + item.scanned, 0),
          routedHighConfidenceNoise: accounts.reduce((n, item) => n + item.routedHighConfidenceNoise, 0),
          keptUncertainOrActionable: accounts.reduce((n, item) => n + item.keptUncertainOrActionable, 0),
          inboxAfter: accounts.reduce((n, item) => n + Number(item.verification?.inboxAfter || 0), 0),
          remainingHighConfidenceRoutableNoise: accounts.reduce((n, item) => n + Number(item.verification?.remainingHighConfidenceRoutableNoise || 0), 0)
        },
        safety: {
          deletesMessages: false,
          usesUidMoveOnly: true,
          scopedAuthorization: 'IONOS_HYGIENE_UID_MOVE_ONLY',
          globalWriteGatesNotRequired: true,
          rehearsalModeBlocksScopedMoves: true,
          autonomousExecuteFalseBlocksScopedMoves: true,
          uncertainMailRemainsInbox: true,
          activeClientMailRemainsInbox: true,
          directSentThreadRepliesRemainInbox: true,
          highConfidenceBounceAutoReplyOooUnsubscribeNoiseMayMove: true,
          noSmtp: true,
          noProspectSend: true,
          noDnsMutation: true
        }
      };
      result.artifact = this.persist(result);
      this.lastResult = result;
      return result;
    } catch (error) {
      const result = { ok: false, status: 'ERROR', enabled: true, execute: this.execute, error: error.message };
      result.artifact = this.persist(result);
      this.lastResult = result;
      return result;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.enabled) return { status: 'DISABLED', enabled: false, executionEnabled: this.execute };
    if (this.timer) return { status: 'ALREADY_RUNNING', enabled: true, executionEnabled: this.execute };
    this.runOnce().catch(() => {});
    this.timer = setInterval(() => this.runOnce().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
    return { status: 'STARTED', enabled: true, executionEnabled: this.execute, intervalMs: this.intervalMs };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = IonosInboxHygieneProductionLoopService;
module.exports.safeFolderFor = safeFolderFor;
module.exports.truthy = truthy;
