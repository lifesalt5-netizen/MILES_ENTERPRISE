'use strict';

const assert = require('assert');
const { officialUsaspendingHost } = require('../SERVICES/orion/OrionOfficialSourceAcquisitionPlanService');

assert.strictEqual(officialUsaspendingHost('https://files.usaspending.gov/archives/a.zip'), true);
assert.strictEqual(officialUsaspendingHost('https://downloads.files.usaspending.gov/a.zip'), true);
assert.strictEqual(officialUsaspendingHost('https://example.com/a.zip'), false);
assert.strictEqual(officialUsaspendingHost('not-a-url'), false);

const serviceSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'SERVICES', 'orion', 'OrionOfficialSourceAcquisitionPlanService.js'), 'utf8');
assert(serviceSource.includes("method: 'HEAD'"));
assert(serviceSource.includes('filesDownloaded: false'));
assert(serviceSource.includes('productionDatabaseModified: false'));
assert(serviceSource.includes('stagingDatabasePromoted: false'));
assert(serviceSource.includes('SAFE_TO_ACQUIRE_OFFICIAL_ARCHIVES_TO_STAGING_ONLY'));
assert(serviceSource.includes('INSUFFICIENT_STAGING_DISK_RESERVE'));
assert(serviceSource.includes('OFFICIAL_ARCHIVE_EXCEEDS_SINGLE_FILE_LIMIT'));

console.log('ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN_TEST_PASS');
