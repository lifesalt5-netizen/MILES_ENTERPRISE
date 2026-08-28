'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const calendarSource = fs.readFileSync(path.join(root, 'CONNECTORS', 'GOOGLE', 'calendar.js'), 'utf8');
const auditSource = fs.readFileSync(path.join(root, 'SCRIPTS', 'AUDIT_MILES_MEETING_PIPELINE.js'), 'utf8');

assert(/calendar\.events\.list/i.test(calendarSource), 'Calendar connector must expose event listing.');
assert(/accountManager\.getAuthClientForAccount/i.test(calendarSource), 'Calendar connector must use account-specific auth.');
assert(!/calendar\.events\.(insert|update|patch|delete)/i.test(calendarSource), 'Calendar connector must not mutate events.');
assert(!/calendar\.calendars\.(insert|update|patch|delete)/i.test(calendarSource), 'Calendar connector must not mutate calendars.');
assert(/externalWritesPerformed:\s*false/i.test(auditSource), 'Meeting audit must certify no external writes.');
assert(!/events\.(insert|update|patch|delete)/i.test(auditSource), 'Meeting audit must remain read-only.');
assert(/CALENDLY_DIRECT_PIPELINE_READ_FAILED_NO_FRESH_ACCEPTANCE_FALLBACK/i.test(auditSource), 'Audit must identify connectivity/provider-read failure when no fresh authoritative Calendly fallback exists.');
assert(/P2GC_MEETING_EVIDENCE_NOT_OBSERVED/i.test(auditSource), 'Audit must separately identify a successful source read with no P2GC meeting evidence.');
assert(/FRESH_ACCEPTANCE_FALLBACK/i.test(auditSource), 'Audit may preserve meeting truth only from a bounded fresh Calendly acceptance fallback.');
assert(/googleCalendarRequiredForBookingTruth:\s*false/i.test(auditSource), 'Google visible-calendar sync must be explicitly supplemental when Calendly is authoritative.');

console.log('PASS meeting_pipeline_readonly_safety_test');
