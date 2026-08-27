require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { OutboundService } = require('./SERVICES/OutboundService');
const RemoteExecutionBridgeSupervisor = require('./SERVICES/runtime/RemoteExecutionBridgeSupervisor');
const InfrastructureHealthScheduler = require('./SERVICES/runtime/InfrastructureHealthScheduler');

const ROOT = process.cwd();
const app = express();
const PORT = process.env.MILES_PORT || 3737;
app.use(express.json());
app.use(express.static(path.join(ROOT,'WEB')));

const startedAt = new Date();
const outbound = new OutboundService(ROOT);
outbound.init();
const remoteBridgeSupervisor = new RemoteExecutionBridgeSupervisor({ root: ROOT });
const bridgeSupervision = remoteBridgeSupervisor.start();
if (!bridgeSupervision.ok) console.error('[MILES DESKTOP] Remote bridge supervision failed:', bridgeSupervision);
else console.log('[MILES DESKTOP] Remote bridge supervision:', bridgeSupervision.status);
const infrastructureHealthScheduler = new InfrastructureHealthScheduler({ root: ROOT, intervalHours: 72 });
const infrastructureScheduling = infrastructureHealthScheduler.start();
console.log('[MILES DESKTOP] Infrastructure health scheduler:', infrastructureScheduling.status, `${infrastructureScheduling.intervalHours}h`);

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
  const infraLast = infrastructureHealthScheduler.audit.lastRun();
  return {
    app:'MILES Desktop', build:'0.1.0-build006', root:ROOT,
    startedAt:startedAt.toISOString(), uptimeSeconds:Math.floor((Date.now()-startedAt.getTime())/1000),
    runtime:'running', scheduler:'running', supervisor:'running',
    remoteBridge: remoteBridgeSupervisor.status(),
    infrastructureHealth:{ due:infrastructureHealthScheduler.audit.due(), lastAudit:infraLast ? { ok:infraLast.ok, observedAt:infraLast.observedAt, recommendations:(infraLast.recommendations||[]).length } : null },
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
    approvals:[
      {id:'WEB-001',department:'Website Operations',title:'Website approval queue has items',status:'Waiting for CEO',recommendation:'Review before publish'},
      {id:'OUT-001',department:'Outbound Operations',title:'Provision expansion inboxes',status:'Prepared',recommendation:'Miles may execute once credentials/process are confirmed'}
    ],
    outbound:out,
    notifications:[{level:'info',message:'Build 006 Outbound Operations online',createdAt:new Date().toISOString()}]
  };
}
app.get('/api/status',(req,res)=>res.json(runtimeStatus()));
app.get('/api/outbound/status',(req,res)=>res.json(outbound.status()));
app.get('/api/outbound/actions',(req,res)=>res.json(outbound.nextActions()));
app.get('/api/outbound/report',(req,res)=>res.type('text/markdown').send(outbound.reportMarkdown()));
app.post('/api/approvals/:id/:decision',(req,res)=>res.json({ok:true,id:req.params.id,decision:req.params.decision,comment:req.body?.comment||'',recordedAt:new Date().toISOString()}));
app.get('/',(req,res)=>res.sendFile(path.join(ROOT,'WEB','index.html')));
const server = app.listen(PORT,()=>console.log(`MILES Desktop Build 006 running: http://localhost:${PORT}`));

function shutdown(signal) {
  console.log(`[MILES DESKTOP] ${signal} shutdown`);
  infrastructureHealthScheduler.stop();
  remoteBridgeSupervisor.stop();
  server.close(() => process.exit(0));
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
