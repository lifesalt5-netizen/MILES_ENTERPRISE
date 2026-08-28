'use strict';

const fs = require('fs');
const path = require('path');
const readonly = require('../../CONNECTORS/IONOS/imap_readonly');
const governed = require('../../CONNECTORS/IONOS/imap_governed');
const ReplyIntelligenceService = require('./ReplyIntelligenceService');
const P2GCCustomerDeliveryService = require('../customer/P2GCCustomerDeliveryService');
const IonosInboxCleanupService = require('./IonosInboxCleanupService');

const { activeClientEmails, actionableHumanMail, folderFor } = IonosInboxCleanupService.helpers;

function clean(v) { return String(v || '').trim(); }
function sameFolder(a, b) { return clean(a).toLowerCase() === clean(b).toLowerCase(); }
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function protectedFolder(name) {
  return /^(sent|sent items|drafts|trash|deleted items|outbox|archive|all mail)$/i.test(clean(name));
}
function destinationFolder(classification, message, clients) {
  return folderFor(classification, message, clients) || 'INBOX';
}

class IonosAllFolderReconciliationService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.env.MILES_ROOT || process.cwd());
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.customerService = options.customerService || P2GCCustomerDeliveryService;
    this.maxPerFolder = Math.min(Math.max(Number(options.maxPerFolder || process.env.MILES_IONOS_ALL_FOLDER_MAX || 2000), 1), 10000);
    this.output = path.join(this.root, 'DATA', 'runtime', 'revenue', 'ionos_all_folder_reconciliation', 'latest.json');
  }

  async fetchFolder(mailbox, folder) {
    const searched = await governed.connectAndRun({ ...mailbox, selectMailbox: folder, readOnly: true, commands: ['UID SEARCH ALL'] });
    const uids = readonly.searchUids(searched.extra?.[0]?.lines || []).slice(-this.maxPerFolder);
    const messages = [];
    for (const ids of chunk(uids, 100)) {
      if (!ids.length) continue;
      const fetched = await governed.connectAndRun({
        ...mailbox,
        selectMailbox: folder,
        readOnly: true,
        commands: [`UID FETCH ${ids.join(',')} (UID BODY.PEEK[]<0.16384>)`]
      });
      messages.push(...readonly.parseFetchedMessages(fetched.extra?.[0]?.lines || [], mailbox.email));
    }
    return messages;
  }

  classifyFolder(folder, messages, clients) {
    const decisions = [];
    for (const message of messages) {
      const classification = this.classifier.classify(message);
      const actionable = actionableHumanMail(classification, message, clients);
      const target = destinationFolder(classification, message, clients);
      decisions.push({
        uid: message.uid,
        from: message.from,
        subject: message.subject,
        sourceFolder: folder,
        targetFolder: target,
        category: classification.category,
        humanReply: classification.humanReply === true,
        actionableReason: actionable.reason,
        alreadyCorrect: sameFolder(folder, target),
        sourceProtected: protectedFolder(folder)
      });
    }
    return decisions;
  }

  async scanMailbox(mailbox) {
    const names = await governed.listMailboxes(mailbox);
    const clients = activeClientEmails(this.customerService);
    const folders = [];
    for (const folder of names) {
      try {
        const messages = await this.fetchFolder(mailbox, folder);
        const decisions = this.classifyFolder(folder, messages, clients);
        folders.push({
          folder,
          protected: protectedFolder(folder),
          scanned: messages.length,
          correct: decisions.filter(x => x.alreadyCorrect).length,
          misrouted: decisions.filter(x => !x.alreadyCorrect).length,
          executableMisroutes: decisions.filter(x => !x.alreadyCorrect && !x.sourceProtected).length,
          protectedHistoricalMismatches: decisions.filter(x => !x.alreadyCorrect && x.sourceProtected).length,
          decisions
        });
      } catch (error) {
        folders.push({ folder, protected: protectedFolder(folder), scanned: 0, error: error.message, decisions: [] });
      }
    }
    return { account: mailbox.email, availableFolders: names, folders };
  }

  async executeMailbox(mailbox, scan) {
    const moves = [];
    const byRoute = new Map();
    for (const folder of scan.folders) {
      if (folder.protected || folder.error) continue;
      for (const decision of folder.decisions) {
        if (decision.alreadyCorrect) continue;
        const key = `${decision.sourceFolder}\u0000${decision.targetFolder}`;
        if (!byRoute.has(key)) byRoute.set(key, { source: decision.sourceFolder, target: decision.targetFolder, uids: [] });
        byRoute.get(key).uids.push(decision.uid);
      }
    }
    for (const route of byRoute.values()) {
      for (const ids of chunk(route.uids, 200)) {
        moves.push(await governed.moveUids(mailbox, ids, route.target, route.source));
      }
    }
    return moves;
  }

  summarizeAccount(scan, verification = null, moves = []) {
    const folders = scan.folders || [];
    return {
      account: scan.account,
      foldersScanned: folders.length,
      messagesScanned: folders.reduce((n, x) => n + Number(x.scanned || 0), 0),
      misroutedBefore: folders.reduce((n, x) => n + Number(x.misrouted || 0), 0),
      executableMisroutesBefore: folders.reduce((n, x) => n + Number(x.executableMisroutes || 0), 0),
      protectedHistoricalMismatches: folders.reduce((n, x) => n + Number(x.protectedHistoricalMismatches || 0), 0),
      folderErrors: folders.filter(x => x.error).map(x => ({ folder: x.folder, error: x.error })),
      moves,
      verification: verification ? {
        executableMisroutesAfter: verification.folders.reduce((n, x) => n + Number(x.executableMisroutes || 0), 0),
        folderErrors: verification.folders.filter(x => x.error).map(x => ({ folder: x.folder, error: x.error }))
      } : null,
      folders
    };
  }

  async run(options = {}) {
    const execute = options.execute === true;
    const accounts = [];
    const errors = [];
    for (const mailbox of readonly.mailboxConfigs()) {
      try {
        const before = await this.scanMailbox(mailbox);
        const moves = execute ? await this.executeMailbox(mailbox, before) : [];
        const after = execute ? await this.scanMailbox(mailbox) : null;
        accounts.push(this.summarizeAccount(before, after, moves));
      } catch (error) {
        errors.push({ account: mailbox.email, error: error.message });
      }
    }

    const result = {
      ok: accounts.length > 0 && errors.length === 0 && accounts.every(account =>
        account.folderErrors.length === 0 && (!execute || account.verification.executableMisroutesAfter === 0)
      ),
      mode: execute ? 'ALL_FOLDER_GOVERNED_RECONCILIATION_WITH_POST_VERIFY' : 'ALL_FOLDER_READ_ONLY_PLAN',
      accounts,
      errors,
      totals: {
        foldersScanned: accounts.reduce((n, x) => n + x.foldersScanned, 0),
        messagesScanned: accounts.reduce((n, x) => n + x.messagesScanned, 0),
        misroutedBefore: accounts.reduce((n, x) => n + x.misroutedBefore, 0),
        executableMisroutesBefore: accounts.reduce((n, x) => n + x.executableMisroutesBefore, 0),
        protectedHistoricalMismatches: accounts.reduce((n, x) => n + x.protectedHistoricalMismatches, 0),
        executableMisroutesAfter: execute ? accounts.reduce((n, x) => n + Number(x.verification?.executableMisroutesAfter || 0), 0) : null
      },
      safety: {
        deletesMessages: false,
        usesUidMoveOnly: true,
        scansAllDiscoveredFolders: true,
        sentDraftTrashArchiveAreAuditOnly: true,
        actionableClientAndSentThreadMailRoutesToInbox: true,
        semanticFoldersAreReconciledBidirectionally: true,
        postMutationAllFolderReadRequired: true
      }
    };
    fs.mkdirSync(path.dirname(this.output), { recursive: true });
    fs.writeFileSync(this.output, JSON.stringify(result, null, 2), 'utf8');
    result.outputFile = this.output;
    return result;
  }
}

module.exports = IonosAllFolderReconciliationService;
module.exports.helpers = { clean, sameFolder, protectedFolder, destinationFolder };
