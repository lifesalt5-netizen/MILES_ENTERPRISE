'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const svc = require('../SERVICES/orion/OrionContractStagingBuildService');

assert.deepStrictEqual(svc.parseCsvRecord('a,b,c'), ['a','b','c']);
assert.deepStrictEqual(svc.parseCsvRecord('a,"b,c","d""e"'), ['a','b,c','d"e']);
assert.strictEqual(svc.csvRecordComplete('a,"b,c"'), true);
assert.strictEqual(svc.csvRecordComplete('a,"b\nc'), false);
assert.strictEqual(svc.csvRecordComplete('a,"b\nc"'), true);

const source = fs.readFileSync(path.join(__dirname,'..','SERVICES','orion','OrionContractStagingBuildService.js'),'utf8');
assert(source.includes('productionDatabaseModified:false'));
assert(source.includes('stagingDatabasePromoted:false'));
assert(source.includes('existingCoreTablesModified:false'));
assert(source.includes('COPYFILE_EXCL'));
assert(source.includes('orion_source_refresh_manifest'));
assert(source.includes('VALIDATE_STAGING_FACTS_AGAINST_CURRENT_ORION_AND_PROMOTION_POLICY'));
assert(!source.includes('UPDATE contractors SET'));
assert(!source.includes('DELETE FROM contractors'));
assert(!source.includes('DELETE FROM buyers'));
assert(!source.includes('DELETE FROM recompetes'));
console.log('ORION_CONTRACT_STAGING_BUILD_TEST_PASS');
