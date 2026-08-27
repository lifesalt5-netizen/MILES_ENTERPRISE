'use strict';
const assert = require('assert');
const path = require('path');
process.env.MILES_ROOT = path.resolve(__dirname, '..');
const mod = require('../SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS');

const now = new Date().toISOString();
assert.strictEqual(mod.freshCalendlyAcceptance({
  generatedAt: now,
  checks: {
    calendly_authentication: 'GREEN',
    scheduled_event_visibility: 'GREEN',
    p2gc_booking_visibility: 'GREEN',
    invitee_visibility: 'GREEN'
  },
  inventory: { p2gcEvents: 15, invitees: 15 }
}), true);
assert.strictEqual(mod.freshCalendlyAcceptance({
  generatedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
  checks: {
    calendly_authentication: 'GREEN',
    scheduled_event_visibility: 'GREEN',
    p2gc_booking_visibility: 'GREEN',
    invitee_visibility: 'GREEN'
  },
  inventory: { p2gcEvents: 15, invitees: 15 }
}), false);
assert.strictEqual(mod.freshCalendlyAcceptance({
  generatedAt: now,
  checks: {
    calendly_authentication: 'GREEN',
    scheduled_event_visibility: 'GREEN',
    p2gc_booking_visibility: 'YELLOW',
    invitee_visibility: 'GREEN'
  },
  inventory: { p2gcEvents: 0, invitees: 0 }
}), false);
console.log('REVENUE_OPERATIONS_CALENDLY_FALLBACK=PASS');
