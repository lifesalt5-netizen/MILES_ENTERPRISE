'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateSledFlCalendlyMeetingRoutingService');
const rules = require('../CONFIG/state_sled_fl_calendly_meeting_routing_rules.json');

const candidates = service.buildMeetingCandidates([
  { email: 'a@example.com', classification: 'POSITIVE', proposedStage: 'Engaged' },
  { email: 'b@example.com', classification: 'NEUTRAL', proposedStage: 'Engaged' },
  { email: 'c@example.com', classification: 'NEGATIVE', proposedStage: 'Lost' }
], rules);

assert.strictEqual(candidates.length, 1);
assert.strictEqual(candidates[0].email, 'a@example.com');
assert.strictEqual(candidates[0].meetingPath, 'CALENDLY_LINK_FIRST');
assert.strictEqual(candidates[0].proposedMeetingStage, 'Meeting Set');
assert.strictEqual(candidates[0].readyForCalendlyReply, true);
assert.strictEqual(candidates[0].calendlyUrl, rules.calendlyUrl);

console.log('STATE_SLED_FL_CALENDLY_MEETING_ROUTING_TEST=PASS');
