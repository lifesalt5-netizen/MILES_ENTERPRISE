'use strict';

const fs = require('fs');
const path = require('path');
const readonly = require('../../CONNECTORS/IONOS/imap_readonly');
const governed = require('../../CONNECTORS/IONOS/imap_governed');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const { CATEGORIES } = ReplyIntelligenceService;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function textOf(message = {}) {
  return `${message.from || ''}\n${message.subject || ''}\n${message.text || ''}`.toLowerCase();
}
function systemNoise(message = {}) {
  const text = textOf(message);
  return /dmarc|aggregate report|instantly|linkedin|google workspace|microsoft|b12|mail delivery subsystem|postmaster|mailer-daemon|notification|security alert|daily report|weekly report/.test(text);
}
function ebuyNotice(message = {}) {
  const text = textOf(message);
  return /ebuy_admin@gsa\.gov|gsa ebuy requests and quotes\/bids|gsa ebuy/i.test(text);
}
function forwardedMilesNoise(message = {}) {
  const from = String(message.from || '').toLowerCase();
  const subject = String(message.subject || '');
  return /lifesalt5@gmail\.com/i.test(from) && /^\s*\[MILES\s+[^\]]+\]\s*Fwd:/i.test(subject);
}
function billingNotice(message = {}) {
  const text = textOf(message);
  return /ionos invoice|invoice .* ionos|billing notification|payment receipt|payment confirmation/i.test(text);
}
function obviousVendorJunk(message = {}) {
  const text = textOf(message);
  const subject = String(message.subject || '').toLowerCase();
  if (/\bq913twe\b/i.test(subject)) return true;
  return /business funding|funding application|business loan|working capital|merchant cash advance|seo services?|link building|lead generation|ai voice|website redesign|can i interest you|would love to work with you|pick your brain|grow your business|new customers|appointment setting|cold email services?/i.test(text);
}
function folderFor(classification = {}, message = {}) {
  if (ebuyNotice(message)) return 'MILES-GSA-EBUY';
  if (forwardedMilesNoise(message)) return 'MILES-FORWARDED';
  if (billingNotice(message)) return 'MILES-BILLING';
  if (systemNoise(message)) return 'MILES-SYSTEM';
  if (obviousVendorJunk(message)) return 'MILES-JUNK';
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

  classifyMessages(messages) {
    const routed = new Map();
    const kept = [];
    const decisions = [];
    for (const message of messages) {
      const classification = this.classifier.classify(message);
      const folder = folderFor(classification, message);
      decisions.push({ uid: message.uid, subject: message.subject, from: message.from, category: classification.category, route: folder || 'KEEP_INBOX' });
      if (!folder) kept.push(message.uid);
      else {
        if (!routed.has(folder)) routed.set(folder, []);
        routed.get(folder).push(message.uid);
      }
    }
    return { routed, kept, decisions };
  }

  async runMailbox(mailbox, execute) {
    const uids = await this.allUids(mailbox);
    const messages = await this.fetchByUids(mailbox, uids);
    const before = this.classifyMessages(messages);
    const moves = [];

    for (const [folder, ids] of before.routed.entries()) {
      if (!execute) {
        moves.push({ ok: true, planned: true, folder, moved: 0, wouldMove: ids.length, destructiveDeleteUsed: false });
        continue;
      }
      for (const batch of chunk(ids, 200)) moves.push(await governed.moveUids(mailbox, batch, folder));
    }

    let verification = null;
    if (execute) {
      await sleep(750);
      const remainingUids = await this.allUids(mailbox);
      const remainingMessages = await this.fetchByUids(mailbox, remainingUids);
      const after = this.classifyMessages(remainingMessages);
      verification = {
        inboxAfter: remainingMessages.length,
        remainingRoutableNoise: [...after.routed.values()].reduce((n, ids) => n + ids.length, 0),
        remainingRoutableFolders: Object.fromEntries([...after.routed.entries()].map(([name, ids]) => [name, ids.length])),
        remainingKept: after.kept.length
      };
    }

    const moveOk = moves.every(x => x.ok !== false);
    const verified = !execute || verification?.remainingRoutableNoise === 0;
    return {
      ok: moveOk && verified,
      account: mailbox.email,
      scanned: messages.length,
      keptInInboxBefore: before.kept.length,
      routedOutOfInbox: [...before.routed.values()].reduce((n, ids) => n + ids.length, 0),
      folders: Object.fromEntries([...before.routed.entries()].map(([name, ids]) => [name, ids.length])),
      moves,
      verification,
      decisions: before.decisions
    };
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const accounts = [];
    const errors = [];
    for (const mailbox of readonly.mailboxConfigs()) {
      try { accounts.push(await this.runMailbox(mailbox, execute)); }
      catch (error) { errors.push({ account: mailbox.email, error: error.message }); }
    }
    const result = {
      ok: accounts.length > 0 && errors.length === 0 && accounts.every(x => x.ok),
      mode: execute ? 'GOVERNED_MAILBOX_MOVE_WITH_POST_VERIFY' : 'PLAN_ONLY',
      accounts,
      errors,
      totals: {
        scanned: accounts.reduce((n, x) => n + x.scanned, 0),
        keptInInboxBefore: accounts.reduce((n, x) => n + x.keptInInboxBefore, 0),
        routedOutOfInbox: accounts.reduce((n, x) => n + x.routedOutOfInbox, 0),
        inboxAfter: accounts.reduce((n, x) => n + Number(x.verification?.inboxAfter || 0), 0),
        remainingRoutableNoise: accounts.reduce((n, x) => n + Number(x.verification?.remainingRoutableNoise || 0), 0)
      },
      safety: {
        deletesMessages: false,
        usesUidMoveOnly: true,
        preservesActionableHumanRepliesInInbox: true,
        preservesOfficialEbuyInDedicatedFolder: true,
        preservesForwardedMailInDedicatedFolder: true,
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
module.exports.helpers = { systemNoise, ebuyNotice, forwardedMilesNoise, billingNotice, obviousVendorJunk, folderFor };
