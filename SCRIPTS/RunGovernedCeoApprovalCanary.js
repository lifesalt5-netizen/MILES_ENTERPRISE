'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const CanonicalApprovalGovernanceService = require('../SERVICES/digital_coo/CanonicalApprovalGovernanceService');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const QUEUE_FILE = path.join(ROOT, 'state', 'business_operations_queue.json');
const TASK_QUEUE_FILE = path.join(ROOT, 'DATA', 'runtime', 'task_queue.json');
const STATE_FILE = path.join(ROOT, 'DATA', 'runtime', 'ceo_approval_governed_canary_latest.json');

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); try { fs.unlinkSync(tmp); } catch {} }
}
function request({ path: requestPath, method = 'GET', payload = null, timeoutMs = 10000 }) {
  return new Promise(resolve => {
    const body = payload == null ? null : JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port: 8787, path: requestPath, method, timeout: timeoutMs,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json, text: json ? null : text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', error => resolve({ ok: false, statusCode: 0, error: error.message, json: null, text: null }));
    if (body) req.write(body);
    req.end();
  });
}

function makeOperation(id, title) {
  const timestamp = now();
  const objective = 'Read-only governed CEO approval canary. Search the local repository for the exact marker "MILES_CEO_GOVERNED_CANARY_MARKER". Do not modify production source, providers, campaigns, email, DNS, B12, ORION, customers, or external systems.';
  return {
    id,
    source: 'MILES_COMMAND_CENTER',
    status: 'AWAITING_APPROVAL',
    provider: 'MILES',
    connector: 'MILES',
    system: 'MILES',
    department: 'Executive Operations',
    action: 'REPOSITORY_SEARCH',
    capability: 'REPOSITORY_SEARCH',
    type: 'REPOSITORY_SEARCH',
    title,
    command: objective,
    objective,
    priority: 4,
    approvalRequired: true,
    ceoEscalationOnly: true,
    approvalDecision: null,
    syntheticCanary: true,
    canaryMarker: 'MILES_CEO_GOVERNED_CANARY_MARKER',
    createdAt: timestamp,
    updatedAt: timestamp,
    plan: {
      provider: 'MILES', connector: 'MILES', system: 'MILES', department: 'Executive Operations',
      action: 'REPOSITORY_SEARCH', capability: 'REPOSITORY_SEARCH',
      objective, originalCommand: objective,
      intent: 'EXECUTE', workflow: 'CEO_APPROVAL_GOVERNED_CANARY'
    }
  };
}

function insertCanaries(canaryIds) {
  const governance = new CanonicalApprovalGovernanceService({ root: ROOT, queueFile: QUEUE_FILE });
  const queue = governance.readQueue();
  queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
  const existing = new Set(queue.operations.map(item => item?.id).filter(Boolean));
  for (const entry of canaryIds) {
    if (!existing.has(entry.id)) queue.operations.unshift(makeOperation(entry.id, entry.title));
  }
  governance.writeQueue(queue);
}

function cleanupCanaries(prefix) {
  const governance = new CanonicalApprovalGovernanceService({ root: ROOT, queueFile: QUEUE_FILE });
  const queue = governance.readQueue();
  const before = Array.isArray(queue.operations) ? queue.operations.length : 0;
  queue.operations = (queue.operations || []).filter(item => {
    const id = String(item?.id || '');
    const parent = String(item?.parentOperationId || item?.revisionOf || '');
    return !id.startsWith(prefix) && !parent.startsWith(prefix);
  });
  governance.writeQueue(queue);
  return { removed: before - queue.operations.length, remaining: queue.operations.length };
}

function getTask(taskId) {
  const tasks = readJson(TASK_QUEUE_FILE, []);
  return Array.isArray(tasks) ? tasks.find(item => String(item?.id || '') === String(taskId || '')) || null : null;
}

async function waitForTask(taskId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = getTask(taskId);
    const status = String(last?.status || '').toUpperCase();
    if (['COMPLETED','FAILED','CANCELLED'].includes(status)) return last;
    await sleep(1000);
  }
  return last;
}

async function main() {
  const requestedId = String(process.argv[2] || '20260829-001').replace(/[^A-Za-z0-9_-]/g, '_');
  const prefix = `CANARY_CEO_${requestedId}_`;
  const prior = readJson(STATE_FILE, null);
  if (prior?.canaryId === requestedId && prior?.phase === 'COMPLETED') {
    console.log(JSON.stringify(prior, null, 2));
    process.exitCode = prior.ok ? 0 : 2;
    return;
  }

  const ids = {
    approve: `${prefix}APPROVE`,
    reject: `${prefix}REJECT`,
    changes: `${prefix}CHANGES`
  };
  const proof = {
    ok: false,
    service: 'MILES_GOVERNED_CEO_APPROVAL_CANARY',
    canaryId: requestedId,
    phase: 'RUNNING',
    startedAt: now(),
    ids,
    checks: {},
    results: {},
    safety: {
      syntheticApprovalRecordsOnly: true,
      approvedExecutionProvider: 'MILES',
      approvedExecutionAction: 'REPOSITORY_SEARCH',
      externalProviderMutation: false,
      campaignMutation: false,
      emailSent: false,
      dnsMutation: false,
      b12Mutation: false,
      orionMutation: false,
      customerMutation: false,
      destructiveGitRecovery: false
    }
  };
  writeJsonAtomic(STATE_FILE, proof);

  try {
    cleanupCanaries(prefix);
    insertCanaries([
      { id: ids.approve, title: 'Synthetic CEO approval canary — APPROVE' },
      { id: ids.reject, title: 'Synthetic CEO approval canary — REJECT' },
      { id: ids.changes, title: 'Synthetic CEO approval canary — REQUEST CHANGES' }
    ]);

    const dashboardInserted = await request({ path: '/api/dashboard' });
    const insertedIds = (dashboardInserted.json?.operations || []).filter(item => String(item?.id || '').startsWith(prefix)).map(item => item.id);
    proof.checks.dashboardShowsThreeCanaries = insertedIds.length === 3;
    proof.results.insertedIds = insertedIds;

    const reject = await request({ path: `/api/operations/${encodeURIComponent(ids.reject)}/reject`, method: 'POST', payload: { reason: 'Synthetic governed canary reject path.' } });
    proof.results.reject = { http: reject.statusCode, status: reject.json?.status || null };
    proof.checks.rejectSucceeded = reject.ok && reject.json?.status === 'REJECTED';

    const changes = await request({ path: `/api/operations/${encodeURIComponent(ids.changes)}/request-changes`, method: 'POST', payload: { instructions: 'Synthetic canary: preserve read-only repository search and add explicit canary marker evidence.' } });
    proof.results.requestChanges = { http: changes.statusCode, status: changes.json?.status || null, revisionOperationId: changes.json?.revisionOperationId || null };
    proof.checks.requestChangesSucceeded = changes.ok && changes.json?.status === 'CHANGES_REQUESTED' && Boolean(changes.json?.revisionOperationId);

    if (changes.json?.revisionOperationId) {
      const rejectRevision = await request({ path: `/api/operations/${encodeURIComponent(changes.json.revisionOperationId)}/reject`, method: 'POST', payload: { reason: 'Synthetic canary cleanup of revision.' } });
      proof.results.rejectRevision = { http: rejectRevision.statusCode, status: rejectRevision.json?.status || null };
      proof.checks.revisionReturnedToApprovalThenRejected = rejectRevision.ok && rejectRevision.json?.status === 'REJECTED';
    } else {
      proof.checks.revisionReturnedToApprovalThenRejected = false;
    }

    const approve = await request({ path: `/api/operations/${encodeURIComponent(ids.approve)}/approve`, method: 'POST', payload: { reason: 'Synthetic canary approval for read-only internal repository search.' } });
    const taskId = approve.json?.enqueueResult?.taskId || approve.json?.operation?.taskId || null;
    proof.results.approve = { http: approve.statusCode, status: approve.json?.status || null, taskId };
    proof.checks.approveBridged = approve.ok && approve.json?.status === 'APPROVED_AND_BRIDGED' && Boolean(taskId);

    const task = taskId ? await waitForTask(taskId) : null;
    proof.results.execution = task ? {
      id: task.id,
      status: task.status,
      action: task.payload?.action || task.type || null,
      provider: task.payload?.provider || null,
      completedAt: task.completedAt || null,
      failedAt: task.failedAt || null,
      error: task.error || null,
      resultOk: task.result?.ok ?? null,
      resultAction: task.result?.action || null
    } : null;
    proof.checks.approvedTaskCompleted = String(task?.status || '').toUpperCase() === 'COMPLETED';
    proof.checks.approvedTaskStayedReadOnlyInternal = String(task?.payload?.provider || '').toUpperCase() === 'MILES' && String(task?.payload?.action || task?.type || '').toUpperCase() === 'REPOSITORY_SEARCH';

    const dashboardAfter = await request({ path: '/api/dashboard' });
    const pendingStatuses = new Set(['AWAITING_APPROVAL','WAITING_FOR_CEO_APPROVAL','AWAITING_CEO_APPROVAL']);
    const remainingPendingCanaries = (dashboardAfter.json?.operations || []).filter(item => String(item?.id || '').startsWith(prefix) && pendingStatuses.has(String(item?.status || '').toUpperCase()));
    proof.checks.noPendingCanaryApprovalsAfterDecisions = remainingPendingCanaries.length === 0;

    proof.ok = Object.values(proof.checks).every(value => value === true);
  } catch (error) {
    proof.error = error.stack || error.message;
    proof.ok = false;
  } finally {
    proof.cleanup = cleanupCanaries(prefix);
    proof.phase = 'COMPLETED';
    proof.finishedAt = now();
    writeJsonAtomic(STATE_FILE, proof);
  }

  console.log('MILES_GOVERNED_CEO_APPROVAL_CANARY');
  console.log(JSON.stringify(proof, null, 2));
  process.exitCode = proof.ok ? 0 : 2;
}

if (require.main === module) main();
module.exports = { main, makeOperation, cleanupCanaries, waitForTask };
