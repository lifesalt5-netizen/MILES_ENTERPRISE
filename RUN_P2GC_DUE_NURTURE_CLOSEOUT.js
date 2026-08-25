'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const QualifiedProspectNurtureService = require('./SERVICES/revenue/QualifiedProspectNurtureService');

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1','true','yes','y','on'].includes(String(raw).trim().toLowerCase());
}
function clean(v) { return String(v || '').trim(); }
function csvSet(v) {
  return new Set(clean(v).split(',').map(x => x.trim()).filter(Boolean));
}
function sorted(values) { return [...values].sort(); }
function sameSet(a, b) {
  const aa = sorted(a);
  const bb = sorted(b);
  return aa.length === bb.length && aa.every((v, i) => v === bb[i]);
}

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  const connector = require('./CONNECTORS/INSTANTLY/connector');
  const service = new QualifiedProspectNurtureService({ rootDir, connector });
  const execute = process.argv.includes('--execute') || boolEnv('P2GC_NURTURE_CLOSEOUT_EXECUTE', false);
  const maxOperations = Math.min(Math.max(Number(process.env.P2GC_NURTURE_CLOSEOUT_MAX || 10), 1), 25);
  const allowedCategories = new Set(['OOO', 'NOT_NOW', 'QUALIFIED_NO_MEETING']);
  const approvedIds = csvSet(process.env.P2GC_NURTURE_APPROVED_IDS || '');
  const approvalToken = clean(process.env.P2GC_NURTURE_CLOSEOUT_APPROVAL);

  const report = await service.buildQueue({ execute: false });
  const queue = Array.isArray(report.queue) ? report.queue : [];
  const currentIds = new Set(queue.map(x => clean(x.id)).filter(Boolean));
  const unsafe = queue.filter(op =>
    !allowedCategories.has(clean(op.category).toUpperCase()) ||
    clean(op.status) !== 'READY_FOR_GOVERNED_EXECUTION' ||
    !clean(op.reply_to_uuid) ||
    !clean(op.eaccount) ||
    !clean(op.subject) ||
    !clean(op.body?.text)
  );

  const evidence = {
    ok: false,
    service: 'P2GC_DUE_NURTURE_CLOSEOUT',
    generatedAt: new Date().toISOString(),
    executeRequested: execute,
    maxOperations,
    queueCount: queue.length,
    operationIds: [...currentIds],
    queue: queue.map(op => ({
      id: op.id,
      category: op.category,
      contactEmail: op.contactEmail,
      companyName: op.companyName,
      campaignId: op.campaignId,
      dueAt: op.dueAt,
      touchNumber: op.touchNumber,
      eaccount: op.eaccount,
      subject: op.subject,
      body: op.body,
      status: op.status
    })),
    safety: {
      allowedCategories: [...allowedCategories],
      maxOperations,
      approvalTokenRequired: true,
      exactOperationIdApprovalRequired: true,
      suppressionCheckedByCanonicalBuilder: report.safety?.suppressionChecked === true,
      crmStopStageCheckedByCanonicalBuilder: report.safety?.crmStopStageChecked === true,
      originalThreadPreferred: report.safety?.originalThreadPreferred === true,
      autoSendPerformedByPlan: false
    }
  };

  if (unsafe.length) {
    evidence.status = 'UNSAFE_NURTURE_QUEUE_BLOCKED';
    evidence.blockedOperations = unsafe.map(x => ({ id: x.id, category: x.category, status: x.status }));
    return persist(rootDir, evidence, 2);
  }

  if (queue.length > maxOperations) {
    evidence.status = 'NURTURE_QUEUE_EXCEEDS_CLOSEOUT_CAP';
    return persist(rootDir, evidence, 2);
  }

  if (!execute) {
    evidence.ok = true;
    evidence.status = queue.length ? 'NURTURE_CLOSEOUT_PLAN_READY' : 'NO_DUE_NURTURE_ACTIONS';
    return persist(rootDir, evidence, 0);
  }

  if (approvalToken !== 'SEND_DUE_NURTURE') {
    evidence.status = 'EXPLICIT_SEND_APPROVAL_REQUIRED';
    return persist(rootDir, evidence, 2);
  }

  if (!approvedIds.size || !sameSet(currentIds, approvedIds)) {
    evidence.status = 'QUEUE_CHANGED_AFTER_APPROVAL';
    evidence.approvedOperationIds = [...approvedIds];
    return persist(rootDir, evidence, 2);
  }

  if (!queue.length) {
    evidence.ok = true;
    evidence.status = 'NO_DUE_NURTURE_ACTIONS';
    evidence.execution = { attempted: 0, executed: 0, results: [] };
    return persist(rootDir, evidence, 0);
  }

  const execution = await service.executeReady(report);
  evidence.execution = execution;
  evidence.ok = execution?.ok === true &&
    Number(execution.attempted || 0) === queue.length &&
    Number(execution.executed || 0) === queue.length &&
    (execution.results || []).every(x => x.executed === true);
  evidence.status = evidence.ok ? 'DUE_NURTURE_EXECUTION_GREEN' : 'DUE_NURTURE_EXECUTION_NOT_GREEN';
  return persist(rootDir, evidence, evidence.ok ? 0 : 2);
}

function persist(rootDir, evidence, code) {
  const outDir = path.join(rootDir, 'DATA', 'runtime', 'revenue', 'nurture');
  fs.mkdirSync(outDir, { recursive: true });
  evidence.outputFile = path.join(outDir, 'closeout_latest.json');
  fs.writeFileSync(evidence.outputFile, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
  process.exitCode = code;
  return evidence;
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});
