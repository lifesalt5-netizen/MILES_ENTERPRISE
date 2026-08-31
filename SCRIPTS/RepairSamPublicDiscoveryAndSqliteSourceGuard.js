'use strict';
const fs=require('fs');const path=require('path');const APPLY=process.argv.includes('--apply');
function patch(file,before,after,label){let t=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');if(t.includes(after)){console.log(label+'=ALREADY_CURRENT');return;}const n=t.split(before).length-1;if(n!==1)throw new Error(label+' anchor count='+n);t=t.replace(before,after);if(APPLY)fs.writeFileSync(file,t,'utf8');console.log(label+'='+(APPLY?'APPLIED':'DRY_RUN_OK'));}
const root=path.resolve(__dirname,'..');
patch(path.join(root,'StartMilesRemoteExecutionBridge.js'),"  SAM_CURRENT_SEND_COLLISION_AUDIT: ['node', ['SCRIPTS/AuditSamCurrentSendCollisions.js']]\n});","  SAM_CURRENT_SEND_COLLISION_AUDIT: ['node', ['SCRIPTS/AuditSamCurrentSendCollisions.js']],\n  SAM_PUBLIC_EMAIL_DISCOVERY: ['node', ['SCRIPTS/DiscoverSamPublicEmails.js']]\n});",'SAM_PUBLIC_DISCOVERY_ALLOWLIST');
const sqlite=path.join(root,'SERVICES','orion','SamSqliteEmailRecoveryService.js');
patch(sqlite,"for(const source of this.sourceCandidates(audit))sourceResults.push(this.processSource(source,ctx,Database));","for(const source of this.sourceCandidates(audit).filter(source=>path.resolve(source.file)!==path.resolve(dbPath)))sourceResults.push(this.processSource(source,ctx,Database));",'SAM_SQLITE_EXCLUDE_TARGET_DB');
