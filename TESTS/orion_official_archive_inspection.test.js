'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'SERVICES', 'orion', 'OrionOfficialArchiveInspectorService.js');
const text = fs.readFileSync(file, 'utf8');
assert(text.includes('ZIP_EOCD_NOT_FOUND'));
assert(text.includes('readCentralDirectory'));
assert(text.includes('readFirstLine'));
assert(text.includes('STAGING_ACQUISITION_NOT_GREEN'));
assert(text.includes('archivesExtracted: false'));
assert(text.includes('productionDatabaseModified: false'));
assert(text.includes('stagingDatabaseCreated: false'));
assert(text.includes('stagingDatabasePromoted: false'));
assert(!text.includes('writeFileSync(file'));
console.log('ORION_OFFICIAL_ARCHIVE_INSPECTION_CONTRACT_PASS');
