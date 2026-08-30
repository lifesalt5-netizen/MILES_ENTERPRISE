'use strict';
const fs=require('fs');
const path=require('path');
const APPLY=process.argv.includes('--apply');
const file=path.resolve(__dirname,'../SERVICES/WorkQueueService.js');
let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
const before=`        if (PROTECTED_GOVERNANCE_TERMS.test(fullText)) {\n            return {\n                requiresKevin: true,\n                executionType: \"APPROVAL_REQUIRED\",\n                reason: \"Protected executive action detected.\"\n            };\n        }`;
const after=`        if (protectedMutationIntent) {\n            return {\n                requiresKevin: true,\n                executionType: \"APPROVAL_REQUIRED\",\n                reason: \"Explicit protected external or destructive action detected.\"\n            };\n        }`;
if(text.includes(after)){console.log('WORKQUEUE_GOVERNANCE_INTENT=ALREADY_CURRENT');process.exit(0);}
const count=text.split(before).length-1;
if(count!==1)throw new Error('WORKQUEUE_GOVERNANCE_INTENT anchor count='+count);
text=text.replace(before,after);
if(APPLY)fs.writeFileSync(file,text,'utf8');
console.log('WORKQUEUE_GOVERNANCE_INTENT='+(APPLY?'APPLIED':'DRY_RUN_OK'));
