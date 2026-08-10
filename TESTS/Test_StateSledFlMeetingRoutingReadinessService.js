'use strict';

const assert = require('assert');
const svc = require('../SERVICES/StateSledFlMeetingRoutingReadinessService');

const r = svc.run();
assert.strictEqual(r.ok, true);
assert.strictEqual(r.gate, 'P1.3W_FL_MEETING_ROUTING_READINESS');
assert.strictEqual(r.safety.createCalendarEvents, false);
assert.strictEqual(r.safety.sendReplies, false);
assert.strictEqual(r.mutationAttempted, false);
assert.strictEqual(r.recommendedMeetingPath, 'CALENDLY_LINK_FIRST');

console.log('STATE_SLED_FL_MEETING_ROUTING_READINESS_TEST=PASS');
