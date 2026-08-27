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
function textOf(message = {}) {
  return `${message.from || ''}\n${message.subject || ''}\n${message.text || ''}`.toLowerCase();
}
function officialEbuy(message = {}) {
  const text = textOf(message);
  return /ebuy_admin@gsa\.gov|gsa ebuy requests and quotes\/bids|gsa ebuy/i.test(text);
}
function systemNoise(message = {}) {
  const text = textOf(message);
  return /dmarc|aggregate report|mail delivery subsystem|mailer-daemon|postmaster|automated notification|security alert/i.test(text);
}
function obviousVendorJunk(message = {}) {
  const text = textOf(message);
  const subject = String(message.subject || '').toLowerCase();
  if (/\bq913twe\b/i.test(subject)) return true;
  return /business funding|funding application|business loan|working capital|merchant cash advance|seo services?|link building|lead generation|ai voice|website redesign|appointment setting|cold email services?|grow your business|new customers/i.test(text);
}
function replyThreadEvidence(message = {}) {
  return Boolean(String(message.inReplyTo || '').trim() || String(message.references || '').trim() || /^\s*re:/i.test(String(message.subject || '')));
}
function rescueDecision(message, classification) {
  if (officialEbuy(message)) return { rescue: true, target: 'MILES-GSA-EBUY', reason: 'OFFICIAL_GSA_EBUY' };
  if (systemNoise(message) || obviousVendorJunk(message)) return { rescue: false, target: null, reason: 'KNOWN_NON_ACTIONABLE_OR_JUNK' };
  if ([CATEGORIES.AUTO_REPLY, CATEGORIES.BOUNCE_TECHNICAL, CATEGORIES.INBOUND_SOLICITATION_SPAM].includes(classification.category)) {
    return { rescue: false, target: null, reason: `NON_ACTIONABLE_CATEGORY:${classification.category}` };
  }
  if (replyThreadEvidence(message) && classification.humanReply === true) {
    return { rescue: true, target: 'INBOX', reason: 'HUMAN_REPLY_WITH_THREAD_EVIDENCE' };
  }
  return { rescue: false, target: null, reason: 'INSUFFICIENT_FALSE_POSITIVE_EVIDENCE' };
}
function chooseSpamFolder(names = []) {
  const exactOrder = ['Spam', 'Junk', 'Junk E-mail', 'Junk Email'];
  for (const wanted of exactOrder) {
    const hit = names.find(name => String(name).toLowerCase() === wanted.toLowerCase());
    if (hit) return hit;
  }
  return names.find(name => /(?:^|[./])(?:spam|junk)(?:$|[./])/i.test(String(name)) && !/^MILES-JUNK$/i.test(String(name))) || null;
}

class IonosSpamRescueService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.maxMessages = Math.min(Math.max(Number(options.maxMessages || 1000), 1), 5000);
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_spam_rescue', 'latest.json');
  }

  async fetchSpam(mailbox, spamFolder) {
    const searched = await governed.connectAndRun({ ...mailbox, selectMailbox: spamFolder, readOnly: true, commands: ['UID SEARCH ALL'] });
    const uids = readonly.searchUids(searched.extra?.[0]?.lines || []).slice(-this.maxMessages);
    const messages = [];
    for (const ids of chunk(uids, 100)) {
      if (!ids.length) continue;
      const fetched = await governed.connectAndRun({
        ...mailbox,
        selectMailbox: spamFolder,
        readOnly: true,
        commands: [`UID FETCH ${ids.join(',')} (UID BODY.PEEK[]<0.16384>)`]
      });
      messages.push(...readonly.parseFetchedMessages(fetched.extra?.[0]?.lines || [], mailbox.email));
    }
    return { uids, messages };
  }

  async runMailbox(mailbox, execute) {
    const names = await governed.listMailboxes(mailbox);
    const spamFolder = chooseSpamFolder(names);
    if (!spamFolder) return { ok: false, account: mailbox.email, blocker: 'IONOS_SPAM_FOLDER_NOT_DISCOVERED', availableMailboxes: names };

    const { messages } = await this.fetchSpam(mailbox, spamFolder);
    const decisions = messages.map(message => {
      const classification = this.classifier.classify(message);
      return { message, classification, decision: rescueDecision(message, classification) };
    });
    const rescueInbox = decisions.filter(x => x.decision.rescue && x.decision.target === 'INBOX').map(x => x.message.uid);
    const rescueEbuy = decisions.filter(x => x.decision.rescue && x.decision.target === 'MILES-GSA-EBUY').map(x => x.message.uid);
    const moves = [];

    if (execute) {
      for (const ids of chunk(rescueInbox, 200)) moves.push(await governed.moveUids(mailbox, ids, 'INBOX', spamFolder));
      for (const ids of chunk(rescueEbuy, 200)) moves.push(await governed.moveUids(mailbox, ids, 'MILES-GSA-EBUY', spamFolder));
    }

    return {
      ok: !execute || moves.every(x => x.ok === true),
      account: mailbox.email,
      spamFolder,
      scanned: messages.length,
      rescueToInbox: rescueInbox.length,
      rescueOfficialEbuy: rescueEbuy.length,
      remainInSpam: messages.length - rescueInbox.length - rescueEbuy.length,
      execute,
      moves,
      rescueCandidates: decisions.filter(x => x.decision.rescue).map(x => ({
        uid: x.message.uid,
        from: x.message.from,
        subject: x.message.subject,
        category: x.classification.category,
        confidence: x.classification.confidence,
        target: x.decision.target,
        reason: x.decision.reason,
        inReplyTo: x.message.inReplyTo || '',
        references: x.message.references || ''
      }))
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
      mode: execute ? 'GOVERNED_FALSE_POSITIVE_RESCUE' : 'READ_ONLY_FALSE_POSITIVE_PLAN',
      accounts,
      errors,
      totals: {
        scannedSpam: accounts.reduce((n, x) => n + Number(x.scanned || 0), 0),
        rescueToInbox: accounts.reduce((n, x) => n + Number(x.rescueToInbox || 0), 0),
        rescueOfficialEbuy: accounts.reduce((n, x) => n + Number(x.rescueOfficialEbuy || 0), 0),
        remainInSpam: accounts.reduce((n, x) => n + Number(x.remainInSpam || 0), 0)
      },
      safety: {
        deletesMessages: false,
        usesUidMoveOnly: true,
        rescueRequiresReplyThreadEvidenceOrOfficialEbuy: true,
        genericPositiveLanguageAloneCannotRescueSpam: true
      }
    };
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    fs.writeFileSync(this.output, JSON.stringify(result, null, 2), 'utf8');
    result.outputFile = this.output;
    return result;
  }
}

module.exports = IonosSpamRescueService;
module.exports.helpers = { officialEbuy, systemNoise, obviousVendorJunk, replyThreadEvidence, rescueDecision, chooseSpamFolder };
