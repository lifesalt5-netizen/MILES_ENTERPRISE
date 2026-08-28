'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IonosInboxCleanupService = require('../SERVICES/revenue/IonosInboxCleanupService');
const { CATEGORIES } = require('../SERVICES/revenue/ReplyIntelligenceService');

const wrapper = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunIonosInboxCleanup.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'IonosInboxCleanupService.js'), 'utf8');
const allFolder = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'IonosAllFolderReconciliationService.js'), 'utf8');
const governed = fs.readFileSync(path.join(__dirname, '..', 'CONNECTORS', 'IONOS', 'imap_governed.js'), 'utf8');
const helpers = IonosInboxCleanupService.helpers;

assert(wrapper.includes("process.argv.includes('--execute')"));
assert(wrapper.includes('IonosAllFolderReconciliationService'));
assert(allFolder.includes('IonosInboxCleanupService.helpers'));
assert(service.includes("mode: execute ? 'GOVERNED_MAILBOX_MOVE_WITH_POST_VERIFY' : 'PLAN_ONLY'"));
assert(service.includes('inboxReservedForActiveClientsAndRealSentThreadReplies: true'));
assert(service.includes('strongAutomationHeadersOverrideReplyThreadHeuristic: true'));
assert(service.includes('genericPositiveLanguageDoesNotKeepInbox: true'));
assert(service.includes('remainingRoutableNoise'));
assert(service.includes('MILES-JUNK'));
assert(governed.includes('UID MOVE'));
assert(!/EXPUNGE/i.test(governed));
assert(!/\\Deleted/i.test(governed));
assert.doesNotThrow(() => new IonosInboxCleanupService(), 'singleton customer service must not be constructed with new');

const clients = new Set(['client@example.com']);
assert.strictEqual(helpers.actionableHumanMail(
  { category: CATEGORIES.UNKNOWN, humanReply: true },
  { from: 'Client <client@example.com>', subject: 'Project update' },
  clients
).keep, true);

const realReply = {
  from: 'Prospect <prospect@example.com>',
  subject: 'Re: federal growth',
  inReplyTo: '<sent@p2gc>',
  references: '<sent@p2gc>',
  rawHeader: 'From: Prospect <prospect@example.com>\r\nIn-Reply-To: <sent@p2gc>'
};
assert.strictEqual(helpers.actionableHumanMail(
  { category: CATEGORIES.MEETING_INTENT, humanReply: true },
  realReply,
  clients
).keep, true);
assert.strictEqual(helpers.folderFor(
  { category: CATEGORIES.MEETING_INTENT, humanReply: true },
  realReply,
  clients
), null, 'real direct prospect reply must remain in Inbox');

assert.strictEqual(helpers.actionableHumanMail(
  { category: CATEGORIES.MEETING_INTENT, humanReply: true },
  { from: 'Cold Seller <seller@example.net>', subject: 'Can we talk?' },
  clients
).keep, false, 'meeting language without client or sent-thread evidence must not stay in Inbox');

assert.strictEqual(helpers.folderFor(
  { category: CATEGORIES.MEETING_INTENT, humanReply: true },
  { from: 'Cold Seller <seller@example.net>', subject: 'Can we talk?' },
  clients
), 'MILES-JUNK');

const bulkNewsletterWithReplyHeaders = {
  from: 'Retail Updates <offers@shop.example>',
  subject: 'Re: Your weekly offers are here',
  inReplyTo: '<old-thread@example>',
  references: '<old-thread@example>',
  rawHeader: 'From: Retail Updates <offers@shop.example>\r\nList-Unsubscribe: <mailto:unsubscribe@shop.example>\r\nPrecedence: bulk\r\nIn-Reply-To: <old-thread@example>'
};
assert.strictEqual(helpers.strongAutomatedOrBulkMail(bulkNewsletterWithReplyHeaders), true);
assert.strictEqual(helpers.folderFor(
  { category: CATEGORIES.NEUTRAL_QUESTION, humanReply: true },
  bulkNewsletterWithReplyHeaders,
  clients
), 'MILES-JUNK', 'bulk/list headers must override reply-thread heuristics');

const accountAlert = {
  from: 'Account Alerts <alerts@bank.example>',
  subject: 'Security alert for your account',
  inReplyTo: '<prior@example>',
  rawHeader: 'From: Account Alerts <alerts@bank.example>\r\nAuto-Submitted: auto-generated\r\nIn-Reply-To: <prior@example>'
};
assert.strictEqual(helpers.strongAutomatedOrBulkMail(accountAlert), true);
assert.strictEqual(helpers.transactionalSystemNotice(accountAlert), true);
assert.strictEqual(helpers.folderFor(
  { category: CATEGORIES.NEUTRAL_QUESTION, humanReply: true },
  accountAlert,
  clients
), 'MILES-SYSTEM', 'automated account/security notices must not occupy executive Inbox');

assert.strictEqual(helpers.folderFor(
  { category: CATEGORIES.AUTO_REPLY, humanReply: false },
  { from: 'eBuy_Admin@gsa.gov', subject: 'GSA eBuy Requests and Quotes/Bids' },
  clients
), 'MILES-GSA-EBUY');

console.log('IONOS_INBOX_CLEANUP_CONTROL=PASS');
