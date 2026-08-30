'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const serviceFile = path.resolve(__dirname, '..', 'SERVICES', 'orion', 'OrionOfficialSourceStagingAcquisitionService.js');
const text = fs.readFileSync(serviceFile, 'utf8');

assert(text.includes("officialUsaspendingHost"));
assert(text.includes("ACQUISITION_PLAN_NOT_GREEN"));
assert(text.includes("INSUFFICIENT_STAGING_DISK_RESERVE"));
assert(text.includes("CONTENT_LENGTH_CHANGED"));
assert(text.includes("DOWNLOADED_SIZE_MISMATCH"));
assert(text.includes(".part"));
assert(text.includes("sha256"));
assert(text.includes("productionDatabaseModified: false"));
assert(text.includes("stagingDatabasePromoted: false"));
assert(text.includes("existingArchiveOverwritten: false"));
assert(!text.includes("unlinkSync(target)"));
assert(!text.includes("renameSync(target"));
console.log('ORION_OFFICIAL_SOURCE_STAGING_ACQUISITION_CONTRACT_PASS');
