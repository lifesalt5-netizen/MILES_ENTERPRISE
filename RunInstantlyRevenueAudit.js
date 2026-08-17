'use strict';

/*
  MILES Enterprise
  File: RunInstantlyRevenueAudit.js
  Purpose: execute one read-only live Instantly revenue audit on the MILES host.
*/

const path = require('path');
const InstantlyRevenueAuditService = require('./SERVICES/digital_coo/InstantlyRevenueAuditService');

async function main() {
  const rootDir = process.env.MILES_ROOT
    ? path.resolve(process.env.MILES_ROOT)
    : __dirname;

  const service = new InstantlyRevenueAuditService({ rootDir });
  const health = await service.healthCheck();

  if (!health.ok) {
    throw new Error(health.error || 'Instantly revenue audit health check failed.');
  }

  const audit = await service.generateAudit();
  const top = audit.summary?.topPriority || null;
  const aggregate = audit.summary?.aggregateFunnel || {};
  const rates = audit.summary?.aggregateRates || {};

  console.log('============================================================');
  console.log('MILES INSTANTLY REVENUE AUDIT — COMPLETE');
  console.log('============================================================');
  console.log(JSON.stringify({
    ok: audit.ok,
    readOnly: audit.readOnly,
    campaignsAudited: audit.summary?.campaignsAudited || 0,
    contacted: aggregate.contacted || 0,
    sent: aggregate.sent || 0,
    humanReplies: aggregate.humanReplies || 0,
    interested: aggregate.interested || 0,
    meetingsBooked: aggregate.meetingsBooked || 0,
    meetingsCompleted: aggregate.meetingsCompleted || 0,
    closed: aggregate.closed || 0,
    replyRate: rates.replyRate ?? null,
    bounceRate: rates.bounceRate ?? null,
    topPriority: top,
    errors: audit.errors?.length || 0
  }, null, 2));

  console.log('');
  console.log(`JSON: ${path.join(rootDir, 'runtime', 'instantly_revenue_audit', 'instantly_revenue_audit_latest.json')}`);
  console.log(`REPORT: ${path.join(rootDir, 'runtime', 'instantly_revenue_audit', 'instantly_revenue_audit_latest.md')}`);

  if (!audit.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error('MILES INSTANTLY REVENUE AUDIT FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
