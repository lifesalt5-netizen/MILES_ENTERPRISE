'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateSledFlPositiveReplyDraftingService');
const rules = require('../CONFIG/state_sled_fl_positive_reply_drafting_rules.json');

const candidate = {
  email: 'buyer@example.com',
  classification: 'POSITIVE',
  raw: { subject: 'Florida government contracting' }
};

const draft = service.buildDraft(candidate, rules);
assert.strictEqual(draft.email, 'buyer@example.com');
assert.strictEqual(draft.classification, 'POSITIVE');
assert.strictEqual(draft.proposedCrmStage, 'Meeting Set');
assert.strictEqual(draft.sendAuthorized, false);
assert.ok(draft.subject.startsWith('Re:'));
assert.ok(draft.body.includes(rules.calendlyUrl));
assert.strictEqual(rules.safety.sendReplies, false);
assert.strictEqual(rules.safety.createCalendarEvents, false);
assert.strictEqual(rules.safety.mutateInstantlyCampaigns, false);
assert.strictEqual(rules.safety.automaticCrmWrites, false);

console.log('STATE_SLED_FL_POSITIVE_REPLY_DRAFTING_TEST=PASS');
