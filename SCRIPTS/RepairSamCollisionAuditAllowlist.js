'use strict';
const fs=require('fs');
const path=require('path');
const APPLY=process.argv.includes('--apply');
const file=path.resolve(__dirname,'../StartMilesRemoteExecutionBridge.js');
let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const before="  SAM_SQLITE_EMAIL_RECOVERY: ['node', ['SCRIPTS/RecoverSamQualifiedEmailsFromSqlite.js']]\n});";
const after="  SAM_SQLITE_EMAIL_RECOVERY: ['node', ['SCRIPTS/RecoverSamQualifiedEmailsFromSqlite.js']],\n  SAM_CURRENT_SEND_COLLISION_AUDIT: ['node', ['SCRIPTS/AuditSamCurrentSendCollisions.js']]\n});";
if(text.includes(after)){console.log('SAM_COLLISION_AUDIT_ALLOWLIST=ALREADY_CURRENT');process.exit(0);}
const count=text.split(before).length-1;
if(count!==1)throw new Error('SAM_COLLISION_AUDIT_ALLOWLIST anchor count='+count);
text=text.replace(before,after);
if(APPLY)fs.writeFileSync(file,text,'utf8');
console.log('SAM_COLLISION_AUDIT_ALLOWLIST='+(APPLY?'APPLIED':'DRY_RUN_OK'));
