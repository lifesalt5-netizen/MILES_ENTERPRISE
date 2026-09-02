'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mod = require('../SCRIPTS/RunZeroCostExternalInboxPlacement');
const { ZERO_COST_TARGET_MAILBOXES } = require('../SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2');

assert.strictEqual(mod.REQUIRED_AUTHORIZATION, 'AUTHORIZE_ZERO_COST_EXTERNAL_PLACEMENT_TESTS');
assert.strictEqual(mod.TEST_RECIPIENT, 'find@myips.io');
assert.strictEqual(ZERO_COST_TARGET_MAILBOXES.length, 13);
assert(ZERO_COST_TARGET_MAILBOXES.every(email => !email.endsWith('@pathways2gc.com')));

const green = mod.classifyReport(`Inbox Placement: 100%\nGmail Inbox\nGoogle Workspace Primary\nOutlook Inbox\nMicrosoft 365 Inbox\nSPF Passed\nDKIM Passed\nDMARC Passed\nSpam: 0%`);
assert.strictEqual(green.status, 'ACTIVE');
assert.strictEqual(green.inboxPct, 100);
assert.strictEqual(green.spamPct, 0);
assert.strictEqual(green.spfPass, true);
assert.strictEqual(green.dkimPass, true);
assert.strictEqual(green.dmarcPass, true);
assert(green.providers.length >= 2);

const spam = mod.classifyReport(`Inbox Placement: 75%\nGmail Inbox\nOutlook Spam\nSPF Passed\nDKIM Passed\nDMARC Passed\nSpam: 25%`);
assert.strictEqual(spam.status, 'WATCH');

const ambiguous = mod.classifyReport(`Your email looks good. SPF Passed DKIM Passed DMARC Passed`);
assert.strictEqual(ambiguous.status, 'UNVERIFIED');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunZeroCostExternalInboxPlacement.js'), 'utf8');
assert(src.includes("const TEST_RECIPIENT = 'find@myips.io'"));
assert(!src.includes('--recipient'));
assert(src.includes("prospectSend: false"));
assert(src.includes("campaignsMutated: false"));
assert(src.includes("dnsMutated: false"));
assert(src.includes("newWorkspaceLicensesPurchased: false"));
assert(src.includes("recurringWorkspaceCostChanged: false"));
assert(src.includes("EXACT_EXTERNAL_PLACEMENT_AUTHORIZATION_REQUIRED"));
assert(src.includes("ZERO_COST_TARGET_MAILBOXES"));

console.log('ZERO_COST_EXTERNAL_INBOX_PLACEMENT_TEST=PASS');
