'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Service = require('../SERVICES/revenue/IonosAllFolderReconciliationService');
const Inbox = require('../SERVICES/revenue/IonosInboxCleanupService');
const SentThreadProof = require('../SERVICES/revenue/IonosSentThreadProof');
const ReplyIntelligenceService = require('../SERVICES/revenue/ReplyIntelligenceService');
const { CATEGORIES } = ReplyIntelligenceService;

const clients = new Set(['client@example.com']);
function classification(category, humanReply = true) { return { category, humanReply }; }
function message(overrides = {}) { return { uid: 1, from: 'Person <person@example.com>', subject: 'Hello', text: 'body', inReplyTo: '', references: '', messageId: '', ...overrides }; }

assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.UNKNOWN, true), message({ from: 'Client <client@example.com>', subject: 'IONOS invoice and security alert' }), clients), null, 'active client mail must override noise-pattern routing and stay actionable');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.INTERESTED, true), message({ inReplyTo: '<sent@example>', subject: 'Re: business funding' }), clients), null, 'base inbox helper still recognizes reply-thread shape');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.OOO, false), message(), clients), 'MILES-OOO');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.AUTO_REPLY, false), message(), clients), 'MILES-AUTO');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.BOUNCE_TECHNICAL, false), message(), clients), 'MILES-BOUNCE');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.NEGATIVE, true), message(), clients), 'MILES-CLOSED');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.UNSUBSCRIBE, true), message(), clients), 'MILES-CLOSED');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.NOT_NOW, true), message(), clients), 'MILES-NURTURE');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.INBOUND_SOLICITATION_SPAM, false), message(), clients), 'MILES-JUNK');
assert.strictEqual(Inbox.helpers.folderFor(classification(CATEGORIES.UNKNOWN, false), message({ from:'noreply-dmarc-support@google.com', subject:'DMARC aggregate report' }), clients), 'MILES-SYSTEM');

const sentIds = SentThreadProof.sentMessageIdSet([
  message({ messageId: '<sent-123@example.com>' }),
  message({ messageId: '<another-456@example.com>' })
]);
assert.strictEqual(SentThreadProof.hasVerifiedSentThread(message({ inReplyTo: '<sent-123@example.com>' }), sentIds), true, 'real sent Message-ID reference must verify');
assert.strictEqual(SentThreadProof.hasVerifiedSentThread(message({ references: '<spoofed@example.com>' }), sentIds), false, 'unverified/spoofed reply header must not verify');
assert.deepStrictEqual(SentThreadProof.threadReferenceIds(message({ references: '<sent-123@example.com> <another-456@example.com>' })), ['sent-123@example.com', 'another-456@example.com']);

assert.strictEqual(Service.helpers.destinationFolder(classification(CATEGORIES.OOO, false), message(), clients), 'MILES-OOO');
assert.strictEqual(Service.helpers.sameFolder('MILES-OOO', 'miles-ooo'), true);
assert.strictEqual(Service.helpers.protectedFolder('Sent'), true);
assert.strictEqual(Service.helpers.protectedFolder('Sent Items'), true);
assert.strictEqual(Service.helpers.sentFolder('Sent'), true);
assert.strictEqual(Service.helpers.sentFolder('Sent Items'), true);
assert.strictEqual(Service.helpers.sentFolder('Trash'), false);
assert.strictEqual(Service.helpers.protectedFolder('Drafts'), true);
assert.strictEqual(Service.helpers.protectedFolder('Trash'), true);
assert.strictEqual(Service.helpers.protectedFolder('Archive'), true);
assert.strictEqual(Service.helpers.protectedFolder('Spam'), false);
assert.strictEqual(Service.helpers.protectedFolder('MILES-OOO'), false);

const source = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'IonosAllFolderReconciliationService.js'), 'utf8');
const remoteRunner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunIonosInboxCleanup.js'), 'utf8');
const governed = fs.readFileSync(path.join(__dirname, '..', 'CONNECTORS', 'IONOS', 'imap_governed.js'), 'utf8');
assert(source.includes('scansAllDiscoveredFolders: true'));
assert(source.includes('sentDraftTrashArchiveAreAuditOnly: true'));
assert(source.includes('directReplyRequiresVerifiedSentMessageId: true'));
assert(source.includes('perMailboxPostVerificationRequired: true'));
assert(source.includes('UNVERIFIED_SENT_THREAD_REFERENCE'));
assert(source.includes('semanticFoldersAreReconciledBidirectionally: true'));
assert(source.includes('postMutationAllFolderReadRequired: true'));
assert(source.includes("governed.moveUids(mailbox, ids, route.target, route.source)"));
assert(remoteRunner.includes("process.argv.includes('--execute')"));
assert(remoteRunner.includes('accounts: accounts.map'));
assert(remoteRunner.includes('inboxBefore: account.inboxBefore'));
assert(remoteRunner.includes('inboxAfter: account.verification?.inboxAfter'));
assert(!/EXPUNGE/i.test(governed));
assert(!/\\Deleted/i.test(governed));

console.log('IONOS_ALL_FOLDER_RECONCILIATION=PASS');
