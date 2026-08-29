require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { OutboundService } = require('./SERVICES/OutboundService');
const InfrastructureHealthAuditService = require('./SERVICES/runtime/InfrastructureHealthAuditService');

const ROOT = process.cwd();
const app = express();
const PORT = process.env.MILES_PORT || 3737;
const COMMAND_PORT = Number(process.env.MILES_COMMAND_PORT || 8787);
app.use(express.json());
app.use(express.static(path.join(ROOT,'WEB')));

const startedAt = new Date();
const outbound = new OutboundService(ROOT);
outbound.init();
const infrastructureHealthAudit = new InfrastructureHealthAuditService({ root: ROOT, intervalHours: 72 });
const bridgeSupervisorStateFile = path.join(ROOT, 'DATA', 'runtime', 'remote_execution_bridge_supervisor.json');
const canonicalApprovalQueueFile = path.join(ROOT, 'state', 'business_operations_queue.json');

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}

function isAwaitingCEOApproval(status) {
  return ['AWAITING_APPROVAL', 'WAITING_FOR_CEO_APPROVAL', 'AWAITING_CEO_APPROVAL']
    .includes(String(status || '').trim().toUpperCase());
}

function canonicalApprovals() {
  const queue = readJsonSafe(canonicalApprovalQueueFile);
  const operations = Array.isArray(queue?.operations) ? queue.operations : [];
  return operations
    .filter(operation => operation && isAwaitingCEOApproval(operation.status))
    .map(operation => ({
      id: operation.id,
      department: operation.department || 'Executive Operations',
      title: operation.title || operation.objective || operation.command || operation.id,
      status: operation.status,
      provider: operation.provider || operation.system || 'MILES',
      connector: operation.connector || null,
      action: operation.action || operation.type || null,
      capability: operation.capability || null,
      command: operation.command || operation.objective || null,
      createdAt: operation.createdAt || null,
      approvalRequired: operation.approvalRequired === true,
      recommendation: 'Review the canonical MILES operation before release to execution.'
    }));
}

async function forwardCanonicalApproval(id, decision, comment = '') {
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['approve', 'reject'].includes(normalizedDecision)) {
    return { ok: false, status: 'INVALID_APPROVAL_DECISION', id, decision };
  }

  const response = await fetch(
    `http://127.0.0.1:${COMMAND_PORT}/api/operations/${encodeURIComponent(id)}/${normalizedDecision}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: comment || '' })
    }
  );

  let payload;
  try { payload = await response.json(); }
  catch { payload = { ok: false, status: 'NON_JSON_APPROVAL_RESPONSE', httpStatus: response.status }; }

  return {
    ...payload,
    canonical: true,
    canonicalSource: canonicalApprovalQueueFile,
    commandCenterPort: COMMAND_PORT,
    httpStatus: response.status
  };
}

console.log('[MILES DESKTOP] Runtime-control ownership delegated to persistent miles-autonomous-coo');

const workforce = [
  ['MILES','Digital COO','Executive Brief / Operations Management','Running'],
  ['Sophia','Segmentation Director','Segment Inventory / Campaign Routing','Running'],
  ['Eleanor','ORION Director','Contractor Intelligence / Data Architecture','Ready'],
  ['Jeff','Opportunity Intelligence','Opportunity Discovery','Ready'],
  ['Claudia','SLED Intelligence','State and Local Coverage','Ready'],
  ['Victoria','Vehicle Intelligence','Vehicle Refresh','Ready'],
  ['Olivia','Forecasting','RFI and Forecast Monitoring','Ready'],
  ['Allison','Recompete Intelligence','Expiration Analysis','Ready'],
  ['Cora','Capture Strategy','Capture Planning','Ready'],
  ['Lucas','Strategic Evaluation','Fit and Pursuit Scoring','Ready']
].map(([name,role,currentTask,status])=>({name,role,currentTask,status,health:'Healthy'}));

function connectorDiscovery(){
  const base = path.join(ROOT,'CONNECTORS');
  if(!fs.existsSync(base)) return [];
  return fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>({name:d.name,status:'detected',health:'unknown',path:path.join('CONNECTORS',d.name)}));
}
function runtimeStatus(){
  const out = outbound.status();
  const infraLast = infrastructureHealthAudit.lastRun();
  const remoteBridge = readJsonSafe(bridgeSupervisorStateFile);
  const approvals = canonicalApprovals();
  return {
    app:'MILES Desktop', build:'0.1.0-build006', root:ROOT,
    startedAt:startedAt.toISOString(), uptimeSeconds:Math.floor((Date.now()-startedAt.getTime())/1000),
    runtime:'running', scheduler:'delegated-to-miles-autonomous-coo', supervisor:'delegated-to-miles-autonomous-coo',
    runtimeControlOwner:'miles-autonomous-coo',
    remoteBridge,
    infrastructureHealth:{ due:infrastructureHealthAudit.due(), lastAudit:infraLast ? { ok:infraLast.ok, observedAt:infraLast.observedAt, recommendations:(infraLast.recommendations||[]).length } : null },
    businessHealth: out.health === 'Healthy' ? 96 : 88,
    connectors:connectorDiscovery(), workforce,
    departments:[
      {name:'Executive Operations',health:'Healthy',status:'Running'},
      {name:'Outbound Operations',health:out.health,status:'Live',summary:`${out.activeInboxes} active inboxes / ${out.dailyCapacity} daily capacity`},
      {name:'Sales Operations',health:'Pending',status:'Planned'},
      {name:'Website Operations',health:'Healthy',status:'Monitoring'},
      {name:'ORION Operations',health:'Pending',status:'Planned'},
      {name:'Executive Demo Operations',health:'Pending',status:'Planned'},
      {name:'Government Intelligence Operations',health:'Pending',status:'Planned'},
      {name:'Engineering Operations',health:'Healthy',status:'Building'}
    ],
    approvals,
    approvalControl:{
      canonical:true,
      source:canonicalApprovalQueueFile,
      count:approvals.length,
      commandCenterPort:COMMAND_PORT
    },
    outbound:out,
    notifications:[{level:'info',message:'Build 006 Outbound Operations online',createdAt:new Date().toISOString()}]
  };
}
app.get('/api/status',(req,res)=>res.json(runtimeStatus()));
app.get('/api/outbound/status',(req,res)=>res.json(outbound.status()));
app.get('/api/outbound/actions',(req,res)=>res.json(outbound.nextActions()));
app.get('/api/outbound/report',(req,res)=>res.type('text/markdown').send(outbound.reportMarkdown()));
app.post('/api/approvals/:id/:decision', async (req,res) => {
  try {
    const result = await forwardCanonicalApproval(req.params.id, req.params.decision, req.body?.comment || req.body?.reason || '');
    res.status(result.ok ? 200 : (result.httpStatus || 400)).json(result);
  } catch (error) {
    res.status(502).json({
      ok:false,
      status:'CANONICAL_APPROVAL_FORWARD_FAILED',
      id:req.params.id,
      decision:req.params.decision,
      error:error.message,
      commandCenterPort:COMMAND_PORT
    });
  }
});
app.get('/',(req,res)=>res.sendFile(path.join(ROOT,'WEB','index.html')));
const server = app.listen(PORT,()=>console.log(`MILES Desktop Build 006 running: http://localhost:${PORT}`));

function shutdown(signal) {
  console.log(`[MILES DESKTOP] ${signal} shutdown`);
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
