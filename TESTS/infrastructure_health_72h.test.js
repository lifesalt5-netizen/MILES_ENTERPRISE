'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const InfrastructureHealthAuditService = require('../SERVICES/runtime/InfrastructureHealthAuditService');
const InfrastructureHealthScheduler = require('../SERVICES/runtime/InfrastructureHealthScheduler');

const root = fs.mkdtempSync(path.join(os.tmpdir(),'miles-infra-health-'));
fs.mkdirSync(path.join(root,'DATA','runtime','infrastructure_health'),{recursive:true});
const audit = new InfrastructureHealthAuditService({ root, intervalHours:72 });
assert.strictEqual(audit.due(Date.now()).due,true);
fs.writeFileSync(audit.latestFile,JSON.stringify({ observedAt:new Date().toISOString(), ok:true }), 'utf8');
assert.strictEqual(audit.due(Date.now()).due,false);
fs.writeFileSync(audit.latestFile,JSON.stringify({ observedAt:new Date(Date.now()-73*3600000).toISOString(), ok:true }), 'utf8');
assert.strictEqual(audit.due(Date.now()).due,true);
assert.strictEqual(audit.intervalHours,72);

const scheduler = new InfrastructureHealthScheduler({ audit, checkMs:60000 });
assert.strictEqual(scheduler.checkMs >= 60000,true);

const serviceSource = fs.readFileSync(path.join(__dirname,'..','SERVICES','runtime','InfrastructureHealthAuditService.js'),'utf8');
const schedulerSource = fs.readFileSync(path.join(__dirname,'..','SERVICES','runtime','InfrastructureHealthScheduler.js'),'utf8');
const startSource = fs.readFileSync(path.join(__dirname,'..','StartMiles.js'),'utf8');
assert(serviceSource.includes("mode:'READ_ONLY_RECOMMENDATION_ONLY'"));
assert(serviceSource.includes('destructiveActionsPerformed:false'));
assert(serviceSource.includes('filesDeleted:false'));
assert(serviceSource.includes('servicesStopped:false'));
assert(serviceSource.includes('appsUninstalled:false'));
assert(serviceSource.includes('dataConsolidated:false'));
assert(serviceSource.includes('recommendationsRequireCEOReviewBeforeDestructiveAction:true'));
assert(!serviceSource.includes('rmSync('));
assert(!serviceSource.includes('unlinkSync('));
assert(!serviceSource.includes('Stop-Process'));
assert(!serviceSource.includes('Remove-Item'));
assert(schedulerSource.includes('this.audit.due()'));
assert(startSource.includes('InfrastructureHealthScheduler'));
assert(startSource.includes('intervalHours: 72'));
assert(startSource.includes('infrastructureHealthScheduler.stop()'));

fs.rmSync(root,{recursive:true,force:true});
console.log('INFRASTRUCTURE_HEALTH_72H=PASS');
