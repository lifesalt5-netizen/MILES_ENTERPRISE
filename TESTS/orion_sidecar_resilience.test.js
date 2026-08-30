'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const text=fs.readFileSync(path.resolve(__dirname,'../SERVICES/orion/OrionContractSidecarBuildService.js'),'utf8');
for(const marker of ['IMPORTING_OFFICIAL_ARCHIVE','DERIVING_SUMMARIES','VALIDATING_SIDECAR','FINALIZING',"phase: 'FAILED'",'partialBytesBeforeCleanup','failedPartialCandidateRemoved','sidecarDb || report?.stagingDb']) assert(text.includes(marker),`missing ${marker}`);
assert(text.includes('productionDatabaseModified:false'));
assert(text.includes('freshnessFabricated:false'));
console.log('ORION_SIDECAR_RESILIENCE_PASS');
