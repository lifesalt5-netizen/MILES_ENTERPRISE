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
assert(src.includes("dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true })"), 'Meeting audit must load repository .env before direct Calendly read');
assert(src.includes('calendly_direct_read'));
assert(src.includes('freshCalendlyAcceptance'));
assert(src.includes('latest_calendly_pipeline_acceptance.json'));
assert(src.includes('FRESH_ACCEPTANCE_FALLBACK'));
assert(src.includes('CALENDLY_ACCEPTANCE_LAST_KNOWN_GOOD'));
assert(src.includes("report.checks.calendly_authentication === 'GREEN'"));
assert(src.includes("report.checks.scheduled_event_visibility === 'GREEN'"));
assert(src.includes("report.checks.p2gc_booking_visibility === 'GREEN'"));
assert(src.includes("report.checks.invitee_visibility === 'GREEN'"));
assert(src.includes('MAX_CALENDLY_ACCEPTANCE_AGE_HOURS'));
assert(src.includes('liveRefreshError'));
assert(src.includes("bookingSource: 'CALENDLY'"));
assert(src.includes("googleCalendarRole: 'SUPPLEMENTAL_VISIBILITY'"));
assert(src.includes('googleCalendarRequiredForBookingTruth: false'));
assert(src.includes('CALENDLY_DIRECT_PIPELINE_READ_FAILED_NO_FRESH_ACCEPTANCE_FALLBACK'));
assert(src.includes('RETRY_CALENDLY_LIVE_REFRESH_WITHOUT_INVALIDATING_BOOKING_TRUTH'));
assert(src.includes('healthyAccounts > 0 && totalCalendarsScanned > 0 && directCalendlyEvidence'), 'Acceptance may use fresh evidence-backed Calendly fallback but must fail closed without authoritative Calendly evidence');
assert(src.includes('externalWritesPerformed: false'));
assert(!src.includes('createEvent('), 'Meeting audit must remain read-only');
assert(!src.includes('sendReply('), 'Meeting audit must not send replies');

console.log('MEETING_PIPELINE_CALENDLY_BRIDGE=PASS');
