'use strict';

const fs = require('fs');
const path = require('path');
const readonly = require('../../CONNECTORS/IONOS/imap_readonly');
const governed = require('../../CONNECTORS/IONOS/imap_governed');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const { CATEGORIES } = ReplyIntelligenceService;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function systemNoise(message = {}) {
  const text = `${message.from || ''}\n${message.subject || ''}`.toLowerCase();
  return /dmarc|aggregate report|instantly|linkedin|google workspace|microsoft|b12|mail delivery subsystem|postmaster|mailer-daemon|notification|security alert|daily report|weekly report/.test(text);
}
function folderFor(classification = {}, message = {}) {
  if (systemNoise(message)) return 'MILES-SYSTEM';
  switch (classification.category) {
    case CATEGORIES.OOO: return 'MILES-OOO';
    case CATEGORIES.AUTO_REPLY:
    case CATEGORIES.INBOUND_SOLICITATION_SPAM: return 'MILES-AUTO';
    case CATEGORIES.BOUNCE_TECHNICAL: return 'MILES-BOUNCE';
    case CATEGORIES.NEGATIVE:
    case CATEGORIES.UNSUBSCRIBE: return 'MILES-CLOSED';
    case CATEGORIES.NOT_NOW: return 'MILES-NURTURE';
    default: return null;
  }
}

class IonosInboxCleanupService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.maxMessages = Math.min(Math.max(Number(options.maxMessages || process.env.MILES_IONOS_CLEANUP_MAX || 5000), 1), 20000);
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_cleanup', 'latest.json');
  }

  async allUids(mailbox) {
    const searched = await readonly.connectAndRun({ ...mailbox, commands: ['UID SEARCH ALL'] });
    return readonly.searchUids(searched.extra?.[0]?.lines || []).slice(-this.maxMessages);
  }

  async fetchByUids(mailbox, uids) {
    const messages = [];
    for (const ids of chunk(uids, 100)) {
      if (!ids.length) continue;
      const fetched = await readonly.connectAndRun({
        ...mailbox,
        commands: [`UID FETCH ${ids.join(',')} (UID BODY.PEEK[]<0.16384>)`]
      });
      messages.push(...readonly.parseFetchedMessages(fetched.extra?.[0]?.lines || [], mailbox.email));
    }
    return messages;
  }

  async runMailbox(mailbox, execute) {
    const uids = await this.allUids(mailbox);
    const messages = await this.fetchByUids(mailbox, uids);
    const routed = new Map();
    const kept = [];
    const decisions = [];

    for (const message of messages) {
      const classification = this.classifier.classify(message);
      const folder = folderFor(classification, message);
      decisions.push({
        uid: message.uid,
        subject: message.subject,
        from: message.from,
        category: classification.category,
        route: folder || 'KEEP_INBOX'
      });
      if (!folder) {
        kept.push(message.uid);
        continue;
      }
      if (!routed.has(folder)) routed.set(folder, []);
      routed.get(folder).push(message.uid);
    }

    const moves = [];
    for (const [folder, ids] of routed.entries()) {
      if (!execute) {
        moves.push({ ok: true, planned: true, folder, moved: 0, wouldMove: ids.length, destructiveDeleteUsed: false });
        continue;
      }
      for (const batch of chunk(ids, 200)) {
        moves.push(await governed.moveUids(mailbox, batch, folder));
      }
    }

    return {
      ok: moves.every(x => x.ok !== false),
      account: mailbox.email,
      scanned: messages.length,
      keptInInbox: kept.length,
      routedOutOfInbox: [...routed.values()].reduce((n, ids) => n + ids.length, 0),
      folders: Object.fromEntries([...routed.entries()].map(([name, ids]) => [name, ids.length])),
      moves,
      decisions
    };
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const accounts = [];
    const errors = [];
    for (const mailbox of readonly.mailboxConfigs()) {
      try {
        accounts.push(await this.runMailbox(mailbox, execute));
      } catch (error) {
        errors.push({ account: mailbox.email, error: error.message });
      }
    }
    const result = {
      ok: accounts.length > 0 && errors.length === 0 && accounts.every(x => x.ok),
      mode: execute ? 'GOVERNED_MAILBOX_MOVE' : 'PLAN_ONLY',
      accounts,
      errors,
      totals: {
        scanned: accounts.reduce((n, x) => n + x.scanned, 0),
        keptInInbox: accounts.reduce((n, x) => n + x.keptInInbox, 0),
        routedOutOfInbox: accounts.reduce((n, x) => n + x.routedOutOfInbox, 0)
      },
      safety: {
        deletesMessages: false,
        usesUidMoveOnly: true,
        preservesActionableHumanRepliesInInbox: true,
        credentialsPersistedByMiles: false
      }
    };
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    fs.writeFileSync(this.output, JSON.stringify(result, null, 2), 'utf8');
    result.outputFile = this.output;
    return result;
  }
}

module.exports = IonosInboxCleanupService;
module.exports.helpers = { systemNoise, folderFor };
