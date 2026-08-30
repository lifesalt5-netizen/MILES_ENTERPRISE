'use strict';
const fs=require('fs');
const path=require('path');
const APPLY=process.argv.includes('--apply');
const file=path.resolve(__dirname,'../StartMilesRemoteExecutionBridge.js');
let text=fs.readFileSync(file,'utf8');
const before="  FEDERAL_SOURCE_READINESS_AUDIT: ['node', ['SCRIPTS/AuditFederalSourceReadiness.js']]\n});";
const after="  FEDERAL_SOURCE_READINESS_AUDIT: ['node', ['SCRIPTS/AuditFederalSourceReadiness.js']],\n  SAM_BULK_EXTRACT_ACQUIRE_STAGING: ['node', ['SCRIPTS/AcquireSamBulkExtractsToStaging.js']]\n});";
if(text.includes(after)){console.log('SAM_BULK_REMOTE_ALLOWLIST=ALREADY_CURRENT');process.exit(0);}
const n=text.split(before).length-1;if(n!==1)throw new Error('SAM_BULK_REMOTE_ALLOWLIST anchor count='+n);
text=text.replace(before,after);if(APPLY)fs.writeFileSync(file,text,'utf8');
console.log('SAM_BULK_REMOTE_ALLOWLIST='+(APPLY?'APPLIED':'DRY_RUN_OK'));
