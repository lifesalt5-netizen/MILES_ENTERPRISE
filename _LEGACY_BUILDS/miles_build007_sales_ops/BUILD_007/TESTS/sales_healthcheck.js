const fs = require('fs');
const path = require('path');
const SalesOperationsService = require('../SERVICES/SalesOperationsService');
const svc = new SalesOperationsService(process.cwd());
const report = svc.initialize();
const required = ['SALES_PIPELINE_MASTER.csv','SALES_ACTIVITY_LOG.csv','SALES_TASK_QUEUE.csv','SALES_DAILY_REPORT.json'];
for (const f of required) {
  const p = path.join(process.cwd(),'DATA','SALES',f);
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
}
if (typeof report.activeOpportunities !== 'number') throw new Error('Invalid report activeOpportunities');
if (!Array.isArray(report.ceoActions)) throw new Error('Invalid report ceoActions');
console.log('MILES Build 007 sales healthcheck passed');
console.log(JSON.stringify({ health: report.health, activeOpportunities: report.activeOpportunities, followUpsDue: report.followUpsDue, pipelineValue: report.pipelineValue }, null, 2));
