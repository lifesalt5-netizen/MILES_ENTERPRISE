'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateSledFlReplyToCrmRoutingService');

const rules = {
  campaignId: 'test-campaign',
  campaignName: 'STATE SLED - FL',
  classToStage: {
    POSITIVE: 'Engaged',
    NEUTRAL: 'Engaged',
    NEGATIVE: 'Lost',
    TECHNICAL: 'Contacted',
    OOO: 'Contacted'
  },
  meetingEligibleClasses: ['POSITIVE'],
  suppressionClasses: ['NEGATIVE']
};

const positive = service.normalizeCandidate({
  classification: 'POSITIVE',
  email: 'buyer@example.com',
  company: 'Example Co'
}, rules);

assert.equal(positive.proposedStage, 'Engaged');
assert.equal(positive.meetingEligible, true);
assert.equal(positive.suppressionCandidate, false);
assert.equal(positive.email, 'buyer@example.com');

const negative = service.normalizeCandidate({
  classification: 'NEGATIVE',
  email: 'no@example.com'
}, rules);

assert.equal(negative.proposedStage, 'Lost');
assert.equal(negative.meetingEligible, false);
assert.equal(negative.suppressionCandidate, true);

const ooo = service.normalizeCandidate({
  classification: 'OOO',
  email: 'ooo@example.com'
}, rules);
assert.equal(ooo.proposedStage, 'Contacted');

console.log('STATE_SLED_FL_REPLY_TO_CRM_ROUTING_TEST=PASS');
