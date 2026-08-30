'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'..'); const APPLY=process.argv.includes('--apply');
const file=path.join(ROOT,'StartMilesRemoteExecutionBridge.js');
let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const line="  ORION_CONTRACT_STAGING_BUILD: ['node', ['SCRIPTS/BuildOrionContractStaging.js']],\n";
if(!text.includes(line)){console.log('ORION_FULL_CLONE_REMOTE_JOB=ALREADY_REMOVED');process.exit(0);}
const count=text.split(line).length-1;if(count!==1)throw new Error(`ORION_FULL_CLONE_REMOTE_JOB: expected one line, found ${count}`);
text=text.replace(line,'');if(APPLY)fs.writeFileSync(file,text,'utf8');
console.log(`ORION_FULL_CLONE_REMOTE_JOB=${APPLY?'REMOVED':'DRY_RUN_OK'}`);
