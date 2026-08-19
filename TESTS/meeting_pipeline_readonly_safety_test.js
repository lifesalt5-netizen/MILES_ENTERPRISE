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
assert(/VERIFY_P2GC_CALENDLY_TARGET_CALENDAR_OR_NO_RECENT_BOOKINGS/i.test(auditSource), 'Audit must distinguish missing P2GC evidence from connectivity failure.');

console.log('PASS meeting_pipeline_readonly_safety_test');
