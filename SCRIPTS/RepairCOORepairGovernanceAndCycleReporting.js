'use strict';
const fs=require('fs');
const path=require('path');
const APPLY=process.argv.includes('--apply');
const ROOT=path.resolve(__dirname,'..');
function patch(file,before,after,label){let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');if(text.includes(after)){console.log(label+'=ALREADY_CURRENT');return;}const n=text.split(before).length-1;if(n!==1)throw new Error(label+': expected one anchor, found '+n);text=text.replace(before,after);if(APPLY)fs.writeFileSync(file,text,'utf8');console.log(label+'='+(APPLY?'APPLIED':'DRY_RUN_OK'));}
const loop=path.join(ROOT,'SERVICES','AutonomousCOOLoopService.js');
patch(loop,
`    if (/delete|pricing|price|contract|legal|publish|dns|domain|payment|hire/.test(text)) {\n      return {\n        safeAutonomous: false,\n        requiresKevin: true,\n        recommendedRepair:\n          \"Prepare diagnosis and request CEO approval before action.\",\n        verification:\n          \"Verify CEO approval is recorded before any protected action.\",\n        rollback: \"No autonomous change performed.\"\n      };\n    }`,
`    const explicitProtectedRepairIntent =\n      /\\b(send|submit|publish|deploy|delete|remove|purge|purchase|charge|pay|transfer|sign|hire|fire|change dns|update dns|modify dns|change credentials|modify credentials|rotate credentials|revoke access|grant access|drop table|alter schema)\\b/i.test(text);\n\n    if (explicitProtectedRepairIntent) {\n      return {\n        safeAutonomous: false,\n        requiresKevin: true,\n        recommendedRepair:\n          \"Prepare diagnosis and request CEO approval before the explicit protected action.\",\n        verification:\n          \"Verify CEO approval is recorded before any protected external or destructive action.\",\n        rollback: \"No autonomous protected change performed.\"\n      };\n    }`,
'COO_REPAIR_GOVERNANCE_INTENT');
const start=path.join(ROOT,'StartAutonomousCOO.js');
patch(start,
`        missionPriorities: result.mission?.priorities?.length || 0,\n        workCreated: result.workCreated?.total || 0,\n        workflowsQueued: result.workflowResults?.length || 0,\n        executionPasses: result.executionResults?.length || 0,`,
`        missionPriorities: result.mission?.priorities?.length || 0,\n        cycleWorkTouched: result.workCreated?.total || 0,\n        cycleAutonomousWorkTouched: result.workCreated?.autonomous || 0,\n        cycleEscalationsTouched: result.workCreated?.escalations || 0,\n        currentOpenWork: result.queue?.open ?? result.queue?.pending ?? null,\n        workflowsProcessedThisCycle: result.workflowResults?.length || 0,\n        executionPassesByCOO: result.executionResults?.length || 0,\n        taskQueueExecutionOwner: \"miles-worker\",\n        reportingNote: \"Cycle counts describe work touched/processed in this COO cycle; they do not mean the persistent work queue is empty.\",`,
'COO_CYCLE_REPORTING_SEMANTICS');
