'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AUDIT_MILES_MEETING_PIPELINE.js'), 'utf8');

assert(src.includes('CalendlyRevenuePipelineService'));
assert(src.includes('READ_ONLY_MEETING_SOURCE_RECONCILIATION'));
assert(src.includes('calendar.listCalendars'));
assert(src.includes('ALL_VISIBLE_CALENDARS_BOUNDED'));
assert(src.includes('P2GC_MEETING_EVIDENCE_CONFIRMED_BY_CALENDLY_GOOGLE_VISIBLE_CALENDAR_SYNC_NOT_OBSERVED'));
assert(src.includes('google_calendar_inventory_scan'));
assert(src.includes('google_calendar_p2gc_sync'));
assert(src.includes('externalWritesPerformed: false'));
assert(!src.includes('createEvent('), 'Meeting audit must remain read-only');
assert(!src.includes('sendReply('), 'Meeting audit must not send replies');

console.log('MEETING_PIPELINE_CALENDLY_BRIDGE=PASS');
