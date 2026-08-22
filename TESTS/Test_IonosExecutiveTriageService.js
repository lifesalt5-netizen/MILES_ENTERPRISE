'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const IonosExecutiveTriageService = require('../SERVICES/revenue/IonosExecutiveTriageService');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-ionos-triage-'));
  const connector = {
    mailboxConfigs() {
      return [
        { email: 'info@pathways2gc.com', password: 'hidden' },
        { email: 'kevin@pathways2gc.com', password: 'hidden' }
      ];
    },
    async fetchRecentMessages(mailbox) {
      if (mailbox.email.startsWith('info@')) {
        return {
          ok: true,
          messages: [
            { id: 'ionos:info:1', uid: 1, from: 'Buyer Name <buyer@example.com>', to: mailbox.email, subject: 'Re: Interested', text: 'Yes, I am interested. Can we schedule a call?', inReplyTo: '<outbound@example>', references: '<outbound@example>', timestamp: new Date().toISOString(), milesExecutiveTriage: false },
            { id: 'ionos:info:2', uid: 2, from: 'lifesalt5@gmail.com', to: mailbox.email, subject: '[MILES UNKNOWN] Fwd: test', text: 'test', timestamp: new Date().toISOString(), milesExecutiveTriage: true },
            { id: 'ionos:info:4', uid: 4, from: 'Marketer <marketer@example.net>', to: mailbox.email, subject: 'Let\'s schedule a call!', text: '', references: '<some-other-thread@example>', timestamp: new Date().toISOString(), milesExecutiveTriage: false }
          ]
        };
      }
      return {
        ok: true,
        messages: [
          { id: 'ionos:kevin:3', uid: 3, from: 'prospect@example.com', to: mailbox.email, subject: 'No thanks', text: 'Not interested.', timestamp: new Date().toISOString(), milesExecutiveTriage: false }
        ]
      };
    }
  };
  const instantlySource = {
    async listEmails() {
      return {
        items: [
          { to_address_email: 'buyer@example.com' },
          { to_address_email: 'prospect@example.com' }
        ],
        next_starting_after: null
      };
    }
  };

  const service = new IonosExecutiveTriageService({ root, connector, instantlySource });
  const first = await service.run({ execute: true });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.outboundCorrelation.ok, true);
  assert.strictEqual(first.outboundCorrelation.uniqueRecipients, 2);
  assert.strictEqual(first.accounts.length, 2);
  assert.strictEqual(first.totals.newMessagesClassified, 3);
  assert.strictEqual(first.totals.qualifiedPositive, 1, 'only known Instantly outbound recipients may count as qualified positive');
  assert.strictEqual(first.totals.uncorrelatedPositiveGated, 1, 'cold solicitation must be gated even when it carries References');
  assert.strictEqual(first.accounts[0].skippedMilesForward, 1);
  const cold = first.accounts[0].decisions.find(d => d.uid === 4);
  assert.strictEqual(cold.qualifiedPositive, false);
  assert.strictEqual(cold.action, 'REVIEW_UNCORRELATED_INBOUND');
  assert.strictEqual(cold.replyEvidence.references, true);
  assert.strictEqual(cold.replyEvidence.knownOutboundRecipient, false);
  const reply = first.accounts[0].decisions.find(d => d.uid === 1);
  assert.strictEqual(reply.qualifiedPositive, true);
  assert.strictEqual(reply.replyEvidence.knownOutboundRecipient, true);
  assert.strictEqual(first.safety.mailboxReadOnly, true);
  assert.strictEqual(first.safety.noSmtp, true);
  assert.strictEqual(first.safety.instantlyReadOnly, true);
  assert.strictEqual(first.safety.qualifiedPositiveRequiresKnownInstantlyOutboundRecipient, true);

  const second = await service.run({ execute: true });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.totals.newMessagesClassified, 0, 'local UID state must dedupe already processed IONOS mail');

  console.log('PASS: IONOS qualified positives require known Instantly outbound recipients; mailbox and Instantly reads remain read-only.');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
