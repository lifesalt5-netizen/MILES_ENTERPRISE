'use strict';
const assert = require('assert');
const { authFailureDetail } = require('../SCRIPTS/AuditInstantlyInboxPlacement');

assert.strictEqual(authFailureDetail({ spf_pass:true, dkim_pass:true, dmarc_pass:true }, 't1'), null);
const dmarc = authFailureDetail({
  sender_email:'maya@pathwaysgovcon.com',
  spf_pass:true,
  dkim_pass:true,
  dmarc_pass:false,
  provider_name:'Google',
  recipient_domain:'gmail.com',
  timestamp_created:'2026-08-27T00:00:00.000Z',
  is_spam:false,
  has_category:false
}, 't2');
assert.deepStrictEqual(dmarc.failures, ['DMARC']);
assert.strictEqual(dmarc.provider, 'Google');
assert.strictEqual(dmarc.recipientDomain, 'gmail.com');
assert.strictEqual(dmarc.dmarcPass, false);

const unlabeled = authFailureDetail({ spf_pass:false, dkim_pass:true, dmarc_pass:false }, 't3');
assert.deepStrictEqual(unlabeled.failures, ['SPF','DMARC']);
assert.strictEqual(unlabeled.provider, null);
console.log('INBOX_PLACEMENT_AUTH_FAILURE_DETAIL=PASS');