'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'AUDIT_MILES_REVENUE_OPERATIONS.js'), 'utf8');
assert(src.includes("const calendlyAcceptancePath = path.join(outDir, 'latest_calendly_pipeline_acceptance.json')"));
assert(src.includes('function freshCalendlyAcceptance(report, maxAgeHours = 24)'));
assert(src.includes("calendlyEvidenceSource = 'LAST_KNOWN_GOOD_ACCEPTANCE'"));
assert(src.includes("status: 'CALENDLY_ACCEPTANCE_LAST_KNOWN_GOOD'"));
assert(src.includes('calendly_refresh_status'));
assert(src.includes('RETRY_CALENDLY_LIVE_REFRESH_WITHOUT_INVALIDATING_MEETING_EVIDENCE'));
assert(src.includes("report.checks.p2gc_booking_visibility === 'GREEN'"));
assert(src.includes("report.checks.invitee_visibility === 'GREEN'"));
assert(src.includes('age > maxAgeHours'));
assert(!src.includes('externalWritesPerformed: true'));
console.log('REVENUE_OPERATIONS_CALENDLY_FALLBACK=PASS');
