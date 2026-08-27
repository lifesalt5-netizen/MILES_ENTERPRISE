'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const service = require('../SERVICES/revenue/IonosSpamRescueService');
const governed = require('../CONNECTORS/IONOS/imap_governed');

const { rescueDecision, chooseSpamFolder } = service.helpers;
assert.strictEqual(chooseSpamFolder(['INBOX', 'Spam', 'MILES-JUNK']), 'Spam');
assert.strictEqual(chooseSpamFolder(['INBOX', 'Junk E-mail']), 'Junk E-mail');

const threaded = {
  from: 'prospect@example.com',
  subject: 'Re: Federal contracting growth',
  text: 'Yes, can we talk next week?',
  inReplyTo: '<original@example>',
  references: '<original@example>'
};
const positive = { category: 'MEETING_INTENT', humanReply: true };
assert.deepStrictEqual(rescueDecision(threaded, positive), {
  rescue: true,
  target: 'INBOX',
  reason: 'HUMAN_REPLY_WITH_THREAD_EVIDENCE'
});

const coldJunk = {
  from: 'seller@example.net',
  subject: 'Can we talk? Q913TWE',
  text: 'Grow your business with our lead generation service.'
};
assert.strictEqual(rescueDecision(coldJunk, positive).rescue, false, 'generic meeting language in spam must not be enough to rescue');

const ebuy = { from: 'ebuy_admin@gsa.gov', subject: 'GSA eBuy Requests and Quotes/Bids', text: '' };
assert.strictEqual(rescueDecision(ebuy, { category: 'UNKNOWN', humanReply: true }).target, 'MILES-GSA-EBUY');

const governedSrc = fs.readFileSync(path.join(__dirname, '..', 'CONNECTORS', 'IONOS', 'imap_governed.js'), 'utf8');
assert(governedSrc.includes("sourceMailbox = 'INBOX'"));
assert(governedSrc.includes('selectMailbox: sourceMailbox'));
assert(governedSrc.includes('UID MOVE'));
assert(!/EXPUNGE/i.test(governedSrc));
assert(!/\\Deleted/i.test(governedSrc));
assert.strictEqual(typeof governed.moveUids, 'function');

console.log('IONOS_SPAM_RESCUE_CONTROL=PASS');
