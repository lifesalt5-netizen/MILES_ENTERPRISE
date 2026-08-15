'use strict';

const fs = require('fs');
const path = require('path');

const DEPARTMENTS = Object.freeze([
  'Executive / CEO',
  'Revenue / Sales',
  'Marketing / Outbound',
  'Lead & Data Operations',
  'ORION / Government Intelligence',
  'Federal Opportunity / Capture',
  'SLED',
  'Proposal / Delivery',
  'Client Operations',
  'Finance / Revenue',
  'Website / Digital',
  'Engineering / MILES',
  'Worker Runtime',
  'Connector Runtime'
]);

function now() { return new Date().toISOString(); }
function clean(v) { return String(v || '').trim(); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function mtime(file) {
  try { return fs.statSync(file).mtime.toISOString(); }
  catch { return null; }
}

function classifyDepartment(item = {}) {
  const text = [item.department,item.area,item.worker,item.provider,item.system,item.connector,item.action,item.type,item.title,item.command]
    .map(v => clean(v).toLowerCase()).join(' ');
  if (/orion|intelligence|award|recompete|vehicle/.test(text)) return 'ORION / Government Intelligence';
  if (/sled|state|local|municipal/.test(text)) return 'SLED';
  if (/proposal|rfp|rfq|bid|delivery/.test(text)) return 'Proposal / Delivery';
  if (/client|customer|account management/.test(text)) return 'Client Operations';
  if (/finance|cash|invoice|payment|pricing/.test(text)) return 'Finance / Revenue';
  if (/website|linkedin|digital/.test(text)) return 'Website / Digital';
  if (/engineering|self_development|architect|builder|github|code|repair/.test(text)) return 'Engineering / MILES';
  if (/connector|provider/.test(text)) return 'Connector Runtime';
  if (/worker|dispatcher|runtime/.test(text)) return 'Worker Runtime';
  if (/lead|data|csv|segment|dedup|verify|enrich/.test(text)) return 'Lead & Data Operations';
  if (/marketing|outbound|instantly|campaign|email/.test(text)) return 'Marketing / Outbound';
  if (/revenue|sales|deal|close|meeting/.test(text)) return 'Revenue / Sales';
  if (/opportunit|capture|forecast|sources sought|rfi/.test(text)) return 'Federal Opportunity / Capture';
  return 'Executive / CEO';
}

function normalizeStatus(v) {
  const s = clean(v).toUpperCase();
  if (!s) return 'UNKNOWN';
  if (/AWAITING|WAITING.*APPROVAL/.test(s)) return 'AWAITING_APPROVAL';
  if (/RUNNING|IN_PROGRESS|EXECUTING|DISPATCHED/.test(s)) return 'RUNNING';
  if (/READY|QUEUED|PENDING|AUTHORIZED/.test(s)) return 'QUEUED';
  if (/COMPLETE|COMPLETED|SUCCESS|SUCCEEDED/.test(s)) return 'COMPLETED';
  if (/FAIL|ERROR|BLOCKED/.test(s)) return 'FAILED';
  if (/REJECT/.test(s)) return 'REJECTED';
  return s;
}

class DepartmentDashboardService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..');
    this.stateDir = path.join(this.rootDir, 'state');
    this.runtimeDir = path.join(this.rootDir, 'DATA', 'runtime');
    this.sources = [
      path.join(this.stateDir, 'business_operations_queue.json'),
      path.join(this.stateDir, 'digital_coo_host_operation_queue.json'),
      path.join(this.runtimeDir, 'work_queue.json'),
      path.join(this.runtimeDir, 'worker_runtime_status.json'),
      path.join(this.runtimeDir, 'production_bootstrap_status.json')
    ];
  }

  collectOperations() {
    const ops = [];
    for (const file of this.sources) {
      const data = readJson(file, null);
      if (!data) continue;
      const arrays = [data.operations, data.tasks, data.items, data.queue].filter(Array.isArray);
      for (const arr of arrays) {
        for (const raw of arr) {
          if (!raw || typeof raw !== 'object') continue;
          ops.push({ ...raw, _source: file, _sourceModifiedAt: mtime(file) });
        }
      }
    }
    const seen = new Set();
    return ops.filter(op => {
      const key = clean(op.id || op.operationId || op.taskId || `${op.title}|${op.createdAt}|${op.action}`);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  runtimeEvidence() {
    const workerFile = path.join(this.runtimeDir, 'worker_runtime_status.json');
    const bootFile = path.join(this.runtimeDir, 'production_bootstrap_status.json');
    return {
      worker: readJson(workerFile, null),
      bootstrap: readJson(bootFile, null),
      evidence: [workerFile, bootFile]
    };
  }

  async snapshot() {
    const operations = this.collectOperations();
    const runtime = this.runtimeEvidence();
    const map = new Map(DEPARTMENTS.map(name => [name, {
      name, status: 'IDLE', health: 'UNKNOWN', current: [], queued: [], blockers: [], recentCompleted: [], awaitingApproval: [], lastActivity: null, evidence: []
    }]));

    for (const op of operations) {
      const name = classifyDepartment(op);
      const d = map.get(name);
      const status = normalizeStatus(op.status);
      const item = {
        id: op.id || op.operationId || op.taskId || null,
        title: op.title || op.command || op.action || op.type || 'Operation',
        action: op.action || op.type || null,
        status,
        worker: op.worker || null,
        provider: op.provider || null,
        updatedAt: op.updatedAt || op.completedAt || op.createdAt || op._sourceModifiedAt || null,
        evidence: op.result?.evidence || op.evidence || op._source
      };
      if (status === 'RUNNING') d.current.push(item);
      else if (status === 'QUEUED') d.queued.push(item);
      else if (status === 'AWAITING_APPROVAL') d.awaitingApproval.push(item);
      else if (status === 'FAILED') d.blockers.push(item);
      else if (status === 'COMPLETED') d.recentCompleted.push(item);
      const ts = item.updatedAt && Date.parse(item.updatedAt);
      if (Number.isFinite(ts) && (!d.lastActivity || ts > Date.parse(d.lastActivity))) d.lastActivity = item.updatedAt;
      if (item.evidence) d.evidence.push(item.evidence);
    }

    const workerOk = runtime.worker?.ok === true;
    const bootstrapOk = runtime.bootstrap?.ok === true && runtime.bootstrap?.startupComplete === true;
    for (const d of map.values()) {
      if (d.blockers.length) d.status = 'BLOCKED';
      else if (d.current.length) d.status = 'RUNNING';
      else if (d.awaitingApproval.length) d.status = 'AWAITING_APPROVAL';
      else if (d.queued.length) d.status = 'QUEUED';
      else if (d.recentCompleted.length) d.status = 'READY';
      d.health = workerOk && bootstrapOk ? 'HEALTHY' : (workerOk || bootstrapOk ? 'DEGRADED' : 'UNKNOWN');
      d.current = d.current.slice(0, 8);
      d.queued = d.queued.slice(0, 8);
      d.blockers = d.blockers.slice(0, 8);
      d.awaitingApproval = d.awaitingApproval.slice(0, 8);
      d.recentCompleted = d.recentCompleted.sort((a,b) => Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).slice(0, 5);
      d.evidence = [...new Set(d.evidence)].slice(0, 10);
    }

    return {
      ok: true,
      status: workerOk && bootstrapOk ? 'HEALTHY' : 'DEGRADED',
      generatedAt: now(),
      operationCount: operations.length,
      departments: [...map.values()],
      runtime: {
        workerOk,
        bootstrapOk,
        workerGeneratedAt: runtime.worker?.generatedAt || null,
        bootstrapGeneratedAt: runtime.bootstrap?.generatedAt || null
      },
      evidence: this.sources.filter(fs.existsSync)
    };
  }
}

module.exports = DepartmentDashboardService;
module.exports.DepartmentDashboardService = DepartmentDashboardService;
module.exports.DEPARTMENTS = DEPARTMENTS;
