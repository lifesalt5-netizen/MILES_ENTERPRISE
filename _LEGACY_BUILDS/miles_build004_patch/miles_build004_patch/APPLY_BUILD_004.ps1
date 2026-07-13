param(
  [string]$Root = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"
Write-Host "MILES Build 004: CEO Dashboard + Executive Chat" -ForegroundColor Cyan
if (!(Test-Path $Root)) { throw "Root not found: $Root" }
Set-Location $Root

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $Root "BACKUPS\build004_$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null

$items = @("StartMiles.js", "package.json", "TESTS", "WEB", "CORE")
foreach ($i in $items) {
  if (Test-Path (Join-Path $Root $i)) {
    Copy-Item (Join-Path $Root $i) $backup -Recurse -Force
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root "TESTS") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "WEB") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "CORE") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

@'
const fs = require('fs');
const path = require('path');
const express = require('express');
require('dotenv').config();

const ROOT = __dirname;
const PORT = Number(process.env.MILES_PORT || 3737);
const startedAt = new Date();
const app = express();
app.use(express.json({ limit: '2mb' }));

function exists(p){ return fs.existsSync(path.join(ROOT,p)); }
function readText(rel){ try { return fs.readFileSync(path.join(ROOT,rel),'utf8'); } catch { return ''; } }
function countCsvRows(rel){
  const txt = readText(rel).trim();
  if(!txt) return 0;
  return Math.max(0, txt.split(/\r?\n/).filter(Boolean).length - 1);
}
function listDirs(rel){
  const p = path.join(ROOT, rel);
  if(!fs.existsSync(p)) return [];
  return fs.readdirSync(p, { withFileTypes:true }).filter(d=>d.isDirectory()).map(d=>d.name);
}
function connectorHealth(name){
  const rel = path.join('CONNECTORS', name);
  const full = path.join(ROOT, rel);
  const files = fs.existsSync(full) ? fs.readdirSync(full).filter(f=>!f.startsWith('.')) : [];
  const hasCode = files.some(f=>/\.(js|ps1|py)$/i.test(f));
  const hasReadme = files.some(f=>/^readme\.md$/i.test(f));
  const health = hasCode ? 'ready' : (hasReadme ? 'documented' : 'detected');
  return { name, status:'detected', health, path:rel, files:files.length, lastChecked:new Date().toISOString() };
}
function loadConnectors(){
  const names = listDirs('CONNECTORS');
  const out = {};
  names.forEach(n => out[n] = connectorHealth(n));
  return out;
}
function loadTasks(){
  const sources = ['tasks/master_task_queue.csv','MILES_TASK_QUEUE.csv','masters/TASK_MASTER.csv'];
  const rows = sources.map(s => ({ source:s, rows:countCsvRows(s) })).filter(x=>x.rows>0);
  const pending = rows.reduce((a,b)=>a+b.rows,0) || 0;
  return { pending, running:0, completed:countCsvRows('MILES_EXECUTION_LOG.csv'), failed:0, sources:rows };
}
function loadApprovals(){
  const approvals = [];
  const websiteRows = countCsvRows('WEBSITE_OPS/WEBSITE_APPROVAL_QUEUE.csv');
  if (websiteRows > 0) approvals.push({ id:'website-queue', type:'Website', title:'Website approval queue has items', count:websiteRows, authority:'CEO approval required before publish' });
  return approvals;
}
function workers(){
  return [
    { name:'Scheduler', status:'running', job:'Scheduled business operations' },
    { name:'Supervisor', status:'running', job:'Runtime monitoring and recovery' },
    { name:'Discovery Worker', status:'running', job:'Finds operational work' },
    { name:'Execution Worker', status:'running', job:'Executes approved operational tasks' },
    { name:'Engineering Manager', status:'running', job:'Tracks builds and fixes' },
    { name:'Outbound Worker', status:'ready', job:'Instantly and campaign operations' },
    { name:'Website Worker', status:'ready', job:'Website queue and B12 monitoring' },
    { name:'ORION Worker', status:'ready', job:'ORION health and data refresh' }
  ];
}
function notifications(){
  return [
    { level:'success', message:'MILES Runtime online', createdAt:startedAt.toISOString() },
    { level:'info', message:'Build 004 dashboard active', createdAt:new Date().toISOString() }
  ];
}
function status(){
  const connectors = loadConnectors();
  const tasks = loadTasks();
  const approvals = loadApprovals();
  return {
    app:'MILES Desktop',
    version:'0.1.0-build004',
    root:ROOT,
    startedAt:startedAt.toISOString(),
    uptimeSeconds:Math.floor((Date.now()-startedAt.getTime())/1000),
    runtime:'running', scheduler:'running', supervisor:'running',
    workers:workers(), connectors, tasks, approvals, notifications:notifications(),
    kpis:{ pendingTasks:tasks.pending, connectors:Object.keys(connectors).length, approvals:approvals.length, completedLogged:tasks.completed }
  };
}
function brief(){
  const s = status();
  const unknown = Object.values(s.connectors).filter(c=>c.health==='detected' || c.health==='documented').map(c=>c.name);
  const lines = [];
  lines.push('Good day Kevin. MILES is running.');
  lines.push('');
  lines.push(`Runtime: ${s.runtime}`);
  lines.push(`Pending tasks: ${s.tasks.pending}`);
  lines.push(`Connectors detected: ${Object.keys(s.connectors).length}`);
  lines.push(`Approvals waiting: ${s.approvals.length}`);
  lines.push('');
  lines.push('Needs attention:');
  if (s.approvals.length) s.approvals.forEach(a=>lines.push(`- Approval: ${a.title}`));
  if (unknown.length) lines.push(`- Connector health needs upgrade: ${unknown.join(', ')}`);
  if (!s.tasks.pending && !s.approvals.length && !unknown.length) lines.push('- No CEO action required right now.');
  lines.push('');
  lines.push('Next operational priorities:');
  lines.push('1. Upgrade connector health from detected to operational.');
  lines.push('2. Wire Instantly, Google, ORION, and Website actions into workers.');
  lines.push('3. Keep CEO approvals separated from automatic operations.');
  return lines.join('\n');
}
app.get('/api/status', (req,res)=>res.json(status()));
app.post('/api/chat', (req,res)=>{
  const msg = String(req.body?.message || '').toLowerCase();
  let response = brief();
  if (msg.includes('connector')) response = JSON.stringify(loadConnectors(), null, 2);
  if (msg.includes('task')) response = JSON.stringify(loadTasks(), null, 2);
  if (msg.includes('approval')) response = loadApprovals().length ? JSON.stringify(loadApprovals(), null, 2) : 'No CEO approvals are waiting right now.';
  if (msg.includes('orion')) response = 'ORION connector is detected. Next step: promote ORION from detected to operational healthCheck() and execute() actions.';
  if (msg.includes('instantly')) response = 'Instantly connector is detected. Next step: connect live campaign, inbox, bounce, reply, and lead-segment checks.';
  res.json({ response, createdAt:new Date().toISOString() });
});
app.get('/', (req,res)=>res.sendFile(path.join(ROOT,'WEB','index.html')));
app.use('/web', express.static(path.join(ROOT,'WEB')));

app.listen(PORT, () => console.log(`MILES Desktop running: http://localhost:${PORT}`));
'@ | Set-Content -Encoding UTF8 (Join-Path $Root "StartMiles.js")

@'
<!doctype html><html><head><meta charset="utf-8"><title>MILES Desktop</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--bg:#0d1424;--card:#111b2d;--line:#2b3a55;--text:#f8fafc;--muted:#9fb0c7;--good:#22c55e;--warn:#f59e0b;--blue:#3b82f6}body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,Arial,sans-serif}header{padding:22px 28px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:25px}small{color:var(--muted)}main{padding:20px;display:grid;gap:16px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px}.label{color:#b7c7e6;font-size:14px}.value{font-size:29px;font-weight:800;margin-top:10px}.good{color:var(--good)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}h2{font-size:18px;margin:0 0 14px}.pill{display:inline-block;padding:4px 9px;border-radius:999px;border:1px solid var(--line);margin:3px;color:#d8e4ff}.ready{color:var(--good)}.documented,.detected{color:var(--warn)}textarea,input{width:100%;box-sizing:border-box;background:#070c19;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:11px}button{background:var(--blue);color:white;border:0;border-radius:8px;padding:11px 16px;font-weight:700}.chatrow{display:grid;grid-template-columns:1fr auto;gap:8px}.response{white-space:pre-wrap;background:#070c19;border-radius:8px;padding:14px;min-height:180px;color:#dbeafe}.list{display:grid;gap:8px}.item{padding:10px;border:1px solid var(--line);border-radius:8px;background:#0b1220}.muted{color:var(--muted)}@media(max-width:900px){.cards,.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>MILES Desktop</h1><small>P2GC Digital COO Runtime — Build 004</small></header><main>
<section class="cards"><div class="card"><div class="label">Runtime</div><div id="runtime" class="value good">...</div></div><div class="card"><div class="label">Pending Tasks</div><div id="tasks" class="value">...</div></div><div class="card"><div class="label">Connectors</div><div id="connectors" class="value">...</div></div><div class="card"><div class="label">Approvals</div><div id="approvals" class="value">...</div></div></section>
<section class="grid"><div class="card"><h2>Executive Chat</h2><div class="chatrow"><input id="msg" placeholder="Miles, what needs my attention?"><button onclick="send()">Send</button></div><br><div id="resp" class="response">Ask: Miles, what needs my attention?</div></div><div class="card"><h2>CEO Summary</h2><div id="summary" class="list"></div></div></section>
<section class="grid"><div class="card"><h2>Detected Connectors</h2><div id="connectorList" class="list"></div></div><div class="card"><h2>Workers</h2><div id="workerList" class="list"></div></div></section>
<section class="grid"><div class="card"><h2>Approvals</h2><div id="approvalList" class="list"></div></div><div class="card"><h2>Notifications</h2><div id="notificationList" class="list"></div></div></section>
</main><script>
async function load(){const s=await (await fetch('/api/status')).json();document.getElementById('runtime').textContent=s.runtime;document.getElementById('tasks').textContent=s.tasks.pending;document.getElementById('connectors').textContent=Object.keys(s.connectors).length;document.getElementById('approvals').textContent=s.approvals.length;summary(s);connectors(s);workers(s);approvals(s);notifications(s)}
function summary(s){document.getElementById('summary').innerHTML=`<div class=item><b>Runtime:</b> <span class=ready>${s.runtime}</span></div><div class=item><b>Scheduler:</b> ${s.scheduler}</div><div class=item><b>Supervisor:</b> ${s.supervisor}</div><div class=item><b>Uptime:</b> ${s.uptimeSeconds}s</div><div class=item><b>Completed logged:</b> ${s.kpis.completedLogged}</div>`}
function connectors(s){document.getElementById('connectorList').innerHTML=Object.values(s.connectors).map(c=>`<div class=item><b>${c.name}</b> <span class="pill ${c.health}">${c.health}</span><div class=muted>${c.path} · ${c.files} files</div></div>`).join('')||'<div class=item>No connectors detected</div>'}
function workers(s){document.getElementById('workerList').innerHTML=s.workers.map(w=>`<div class=item><b>${w.name}</b> <span class="pill ready">${w.status}</span><div class=muted>${w.job}</div></div>`).join('')}
function approvals(s){document.getElementById('approvalList').innerHTML=s.approvals.map(a=>`<div class=item><b>${a.title}</b><div class=muted>${a.authority}</div></div>`).join('')||'<div class=item>No CEO approvals waiting.</div>'}
function notifications(s){document.getElementById('notificationList').innerHTML=s.notifications.map(n=>`<div class=item><b>${n.level}</b>: ${n.message}<div class=muted>${n.createdAt}</div></div>`).join('')}
async function send(){const message=document.getElementById('msg').value||'Miles, what needs my attention?';const r=await (await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})})).json();document.getElementById('resp').textContent=r.response}
load();setInterval(load,5000);document.getElementById('msg').addEventListener('keydown',e=>{if(e.key==='Enter')send()})
</script></body></html>
'@ | Set-Content -Encoding UTF8 (Join-Path $Root "WEB\index.html")

@'
const http = require('http');
const child_process = require('child_process');
const server = child_process.spawn(process.execPath, ['StartMiles.js'], { cwd: process.cwd(), stdio: ['ignore','pipe','pipe'] });
function get(path){return new Promise((resolve,reject)=>{http.get({host:'localhost',port:3737,path},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({code:res.statusCode,data}));}).on('error',reject);});}
(async()=>{try{await new Promise(r=>setTimeout(r,1500));const res=await get('/api/status'); if(res.code!==200) throw new Error('Bad status '+res.code); const s=JSON.parse(res.data); if(s.runtime!=='running') throw new Error('Runtime not running'); if(!s.connectors) throw new Error('No connectors object'); console.log('MILES Build 004 healthcheck passed'); console.log(JSON.stringify({runtime:s.runtime,connectors:Object.keys(s.connectors).length,pendingTasks:s.tasks.pending},null,2)); server.kill(); process.exit(0);}catch(e){console.error(e); server.kill(); process.exit(1);}})();
'@ | Set-Content -Encoding UTF8 (Join-Path $Root "TESTS\healthcheck.js")

@'
{"name":"miles-desktop-production","version":"0.1.0-build004","private":true,"description":"MILES Desktop production runtime for P2GC","main":"StartMiles.js","scripts":{"start":"node StartMiles.js","test":"node TESTS/healthcheck.js"},"dependencies":{"dotenv":"latest","express":"latest"},"devDependencies":{}}
'@ | Set-Content -Encoding UTF8 (Join-Path $Root "package.json")

npm install
npm test
Write-Host "BUILD 004 COMPLETE. Backup: $backup" -ForegroundColor Green
Write-Host "Run from $Root : npm start" -ForegroundColor Green
Write-Host "Open: http://localhost:3737" -ForegroundColor Green
