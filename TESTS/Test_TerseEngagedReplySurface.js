'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExecutiveReplySurfacePolicyService = require('../SERVICES/revenue/ExecutiveReplySurfacePolicyService');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-terse-reply-surface-'));
const service = new ExecutiveReplySurfacePolicyService({ rootDir: root });

const why = service.apply({
  category: 'NEUTRAL_QUESTION',
  humanReply: true,
  qualifiedPositive: false,
  from: 'jules@example.com',
  campaignId: 'campaign-1',
  leadId: 'lead-1',
  preview: 'Why?'
});
assert.strictEqual(why.surfaceToExecutiveInbox, true);
assert.strictEqual(why.executiveDisposition, 'SURFACE_ENGAGED_QUESTION');
assert.strictEqual(why.engagedQuestion, true);
assert.strictEqual(why.requiresHumanAttention, true);

for (const preview of ['How so?', 'Which one?', 'What do you mean?', 'Why us?']) {
  const result = service.disposition({
    category: 'NEUTRAL_QUESTION',
    humanReply: true,
    campaignId: 'campaign-1',
    preview
  });
  assert.strictEqual(result.surfaceToExecutiveInbox, true, `${preview} should surface`);
  assert.strictEqual(result.executiveDisposition, 'SURFACE_ENGAGED_QUESTION');
}

const ordinaryNeutral = service.disposition({
  category: 'NEUTRAL_QUESTION',
  humanReply: true,
  campaignId: 'campaign-1',
  leadId: 'lead-1',
  preview: 'Can you send some information about what is included?'
});
assert.strictEqual(ordinaryNeutral.surfaceToExecutiveInbox, false);
assert.strictEqual(ordinaryNeutral.destination, 'MANUAL_REVIEW_QUEUE');

const randomInboundWhy = service.disposition({
  category: 'NEUTRAL_QUESTION',
  humanReply: true,
  campaignId: '',
  leadId: '',
  preview: 'Why?'
});
assert.strictEqual(randomInboundWhy.surfaceToExecutiveInbox, false);

fs.rmSync(root, { recursive: true, force: true });
console.log('TERSE_ENGAGED_REPLY_SURFACE_TEST=PASS');
