'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IonosInboxCleanupService = require('../SERVICES/revenue/IonosInboxCleanupService');
const { CATEGORIES } = require('../SERVICES/revenue/ReplyIntelligenceService');

const wrapper = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunIonosInboxCleanup.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'revenue', 'IonosInboxCleanupService.js'), 'utf8');
const governed = fs.readFileSync(path.join(__dirname, '..', 'CONNECTORS', 'IONOS', 'imap_governed.js'), 'utf8');
const helpers = IonosInboxCleanupService.helpers;

assert(wrapper.includes("process.argv.includes('--execute')"));
assert(wrapper.includes('IonosInboxCleanupService'));
assert(service.includes("mode: execute ? 'GOVERNED_MAILBOX_MOVE_WITH_POST_VERIFY' : 'PLAN_ONLY'"));
assert(service.includes('inboxReservedForActiveClientsAndRealSentThreadReplies: true'));
assert(service.includes('genericPositiveLanguageDoesNotKeepInbox: true'));
assert(service.includes('remainingRoutableNoise'));
assert(service.includes('MILES-JUNK'));
assert(governed.includes('UID MOVE'));
assert(!/EXPUNGE/i.test(governed));
assert(!/\\Deleted/i.test(governed));

const clients = new Set(['client@example.com']);
assert.strictEqual(helpers.actionableHumanMail(
  { category: CATEGORIES.UNKNOWN, humanReply: true },
  { from: 'Client <client@example.com>', subject: 'Project update' },
  clients
).keep, true);

assert.strictEqual(helpers.actionableHumanMail(
  { category: CATEGORIES.MEETING_INTENT, humanReply: true },
  { from: 'Prospect <prospect@example.com>', subject: 'Re: federal growth', inReplyTo: '<sent@p2gc>' },
  clients
).keep, true);

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

console.log('IONOS_INBOX_CLEANUP_CONTROL=PASS');
