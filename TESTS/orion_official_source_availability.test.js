'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'SERVICES', 'orion', 'OrionOfficialSourceAvailabilityService.js'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'SCRIPTS', 'AuditOrionOfficialSourceAvailability.js'), 'utf8');

assert(service.includes('https://api.usaspending.gov/api/v2/bulk_download/list_monthly_files/'));
assert(service.includes("agency: 'all'"));
assert(service.includes("type: 'contracts'"));
assert(service.includes('fiscal_year'));
assert(service.includes('downloadsPerformed: false'));
assert(service.includes('wholeOrionFreshnessClaimed: false'));
assert(service.includes('officialSourceNewerThanOrion'));
assert(service.includes('USAspending.gov'));
assert(!service.includes('writeFileSync'));
assert(!service.includes('createWriteStream'));
assert(!service.includes('pipeline('));
assert(!service.includes('unlinkSync'));

assert(audit.includes('MILES ORION OFFICIAL SOURCE AVAILABILITY - READ ONLY'));
assert(audit.includes('ORION_OFFICIAL_SOURCE_AVAILABILITY_GREEN'));
assert(audit.includes('Downloads performed:'));
assert(audit.includes('Whole ORION freshness claimed:'));
assert(audit.includes('latest_official_source_availability.json'));

console.log('ORION_OFFICIAL_SOURCE_AVAILABILITY_CONTRACT=PASS');
