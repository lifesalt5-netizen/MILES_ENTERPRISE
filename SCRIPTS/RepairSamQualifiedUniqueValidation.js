'use strict';
const fs=require('fs'),path=require('path');const APPLY=process.argv.includes('--apply');const file=path.resolve(__dirname,'../SERVICES/orion/SamQualifiedUniverseBuildService.js');let t=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const before1="const c=parseRecord(f);if(c.registrationStatus!=='A')expired++;const ev=this.eligibility.evaluate(c);";
const after1="const c=parseRecord(f);if(!c.uei){malformed++;continue;}if(c.registrationStatus!=='A')expired++;const ev=this.eligibility.evaluate(c);";
const before2="qualified,stored,rejected,reviewRequired:review,expiredObserved:expired";
const after2="qualified,uniqueQualified:stored,duplicateQualifiedRecords:Math.max(0,qualified-stored),stored,rejected,reviewRequired:review,expiredObserved:expired";
const before3="if(integrity!=='ok'||stored!==qualified||stored<=0)throw new Error(`SAM_QUALIFIED_VALIDATION_FAILED:${integrity}:${stored}:${qualified}`);";
const after3="if(integrity!=='ok'||stored<=0||stored>qualified)throw new Error(`SAM_QUALIFIED_VALIDATION_FAILED:${integrity}:${stored}:${qualified}`);";
for(const [before,after,label] of [[before1,after1,'UEI_GUARD'],[before2,after2,'UNIQUE_COUNTS'],[before3,after3,'UNIQUE_VALIDATION']]){if(t.includes(after))continue;const n=t.split(before).length-1;if(n!==1)throw new Error(label+': anchor count='+n);t=t.replace(before,after);}if(APPLY)fs.writeFileSync(file,t,'utf8');console.log('SAM_QUALIFIED_UNIQUE_VALIDATION='+(APPLY?'APPLIED':'DRY_RUN_OK'));
