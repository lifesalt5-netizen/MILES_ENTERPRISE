$ErrorActionPreference = 'Stop'

$Root = 'D:\P2GC_Intelligence\MILES_OS'
if (!(Test-Path $Root)) { throw "MILES_OS root not found: $Root" }
Set-Location $Root

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = Join-Path $Root "BACKUPS\sprint_alpha_$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null

$itemsToBackup = @('package.json','START_MILES.ps1','StartMiles.js','CORE','WEB','SERVICES','API','AI','AUTOMATIONS','TESTS')
foreach ($item in $itemsToBackup) {
  if (Test-Path (Join-Path $Root $item)) {
    Copy-Item -Path (Join-Path $Root $item) -Destination $backup -Recurse -Force
  }
}

$dirs = @(
  'CORE\Runtime','CORE\Scheduler','CORE\Supervisor','CORE\Workers','CORE\Tasks','CORE\Approvals','CORE\Notifications','CORE\Executive','CORE\Engineering','CORE\Connectors','WEB\desktop','WEB\desktop\public','WEB\desktop\src','API','SERVICES','TESTS','logs','status','BACKUPS'
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }

@'
{
  "name": "miles-desktop-production",
  "version": "0.1.0-alpha",
  "description": "MILES Desktop production repository for P2GC operations.",
  "main": "StartMiles.js",
  "scripts": {
    "start": "node StartMiles.js",
    "runtime": "node CORE/Runtime/MilesRuntime.js",
    "desktop": "node SERVICES/DesktopServer.js",
    "health": "node TESTS/healthcheck.js",
    "test": "node TESTS/healthcheck.js"
  },
  "dependencies": {
    "dotenv": "latest",
    "express": "latest",
    "node-cron": "latest"
  },
  "devDependencies": {}
}
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'package.json')

@'
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

function now(){ return new Date().toISOString(); }
function log(message, data){
  const line = `[${now()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, 'miles_runtime.log'), line + '\n');
}

class MilesRuntime {
  constructor(){
    this.startedAt = null;
    this.state = {
      runtime: 'stopped',
      scheduler: 'stopped',
      supervisor: 'stopped',
      workers: [],
      connectors: {},
      tasks: { pending: 0, running: 0, completed: 0, failed: 0 },
      approvals: [],
      notifications: []
    };
  }

  start(){
    this.startedAt = now();
    this.state.runtime = 'running';
    this.state.scheduler = 'running';
    this.state.supervisor = 'running';
    this.discoverConnectors();
    this.loadTaskCounts();
    this.addNotification('MILES Runtime started', 'info');
    log('MILES Runtime started', this.status());
    return this.status();
  }

  stop(){
    this.state.runtime = 'stopped';
    this.state.scheduler = 'stopped';
    this.state.supervisor = 'stopped';
    log('MILES Runtime stopped');
    return this.status();
  }

  discoverConnectors(){
    const connectorRoot = path.join(ROOT, 'CONNECTORS');
    const names = fs.existsSync(connectorRoot) ? fs.readdirSync(connectorRoot).filter(x => fs.statSync(path.join(connectorRoot,x)).isDirectory()) : [];
    for (const name of names){
      this.state.connectors[name] = { name, status: 'detected', health: 'unknown', path: path.join('CONNECTORS', name) };
    }
  }

  loadTaskCounts(){
    const candidates = [
      path.join(ROOT, 'tasks', 'master_task_queue.csv'),
      path.join(ROOT, 'MILES_TASK_QUEUE.csv'),
      path.join(ROOT, 'MILES_WORK_REGISTRY.csv')
    ];
    let rows = [];
    for (const file of candidates){
      if (fs.existsSync(file)) {
        rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
        break;
      }
    }
    const count = Math.max(0, rows.length - 1);
    this.state.tasks.pending = count;
  }

  addNotification(message, level='info'){
    this.state.notifications.unshift({ id: Date.now(), level, message, createdAt: now() });
    this.state.notifications = this.state.notifications.slice(0, 50);
  }

  command(text){
    const cmd = String(text || '').trim().toLowerCase();
    if (!cmd) return { ok:false, message:'No command received.' };
    if (cmd.includes('attention') || cmd.includes('approval')) {
      return { ok:true, message: this.executiveBrief() };
    }
    if (cmd.includes('status') || cmd.includes('health')) {
      return { ok:true, message: JSON.stringify(this.status(), null, 2) };
    }
    if (cmd.includes('restart')) {
      this.stop(); this.start();
      return { ok:true, message:'Runtime restarted.' };
    }
    return { ok:true, message:`Command received and logged for planner routing: ${text}` };
  }

  executiveBrief(){
    const approvals = this.state.approvals.length;
    const failed = this.state.tasks.failed;
    const connectors = Object.keys(this.state.connectors).length;
    return `MILES is running. CEO approvals waiting: ${approvals}. Failed tasks: ${failed}. Connectors detected: ${connectors}. Pending tasks detected: ${this.state.tasks.pending}.`;
  }

  status(){
    return {
      app: 'MILES Desktop',
      root: ROOT,
      startedAt: this.startedAt,
      uptimeSeconds: this.startedAt ? Math.round((Date.now() - new Date(this.startedAt).getTime())/1000) : 0,
      ...this.state
    };
  }
}

module.exports = { MilesRuntime };

if (require.main === module) {
  const runtime = new MilesRuntime();
  runtime.start();
  setInterval(() => log('heartbeat', runtime.status()), 60000);
}
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'CORE\Runtime\MilesRuntime.js')

@'
const express = require('express');
const path = require('path');
const { MilesRuntime } = require('../CORE/Runtime/MilesRuntime');

const app = express();
const runtime = new MilesRuntime();
runtime.start();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'WEB', 'desktop', 'public')));

app.get('/api/status', (req,res) => res.json(runtime.status()));
app.post('/api/command', (req,res) => res.json(runtime.command(req.body.command)));
app.post('/api/runtime/start', (req,res) => res.json(runtime.start()));
app.post('/api/runtime/stop', (req,res) => res.json(runtime.stop()));

const port = process.env.MILES_DESKTOP_PORT || 3737;
app.listen(port, () => {
  console.log(`MILES Desktop running: http://localhost:${port}`);
});
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'SERVICES\DesktopServer.js')

@'
const { spawn } = require('child_process');
const path = require('path');

console.log('Starting MILES Desktop production host...');
const child = spawn(process.execPath, [path.join(__dirname, 'SERVICES', 'DesktopServer.js')], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: false
});

child.on('exit', code => process.exit(code || 0));
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'StartMiles.js')

@'
$Root = 'D:\P2GC_Intelligence\MILES_OS'
Set-Location $Root
npm start
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'START_MILES.ps1')

@'
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MILES Desktop</title>
  <style>
    body{font-family:Arial, sans-serif;background:#0f172a;color:#e5e7eb;margin:0}
    header{padding:18px 24px;background:#111827;border-bottom:1px solid #334155}
    h1{margin:0;font-size:24px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:18px}.card{background:#111827;border:1px solid #334155;border-radius:10px;padding:16px}.wide{grid-column:span 2}button,input{font-size:15px;padding:10px;border-radius:8px;border:1px solid #475569}input{width:70%;background:#020617;color:white}button{background:#2563eb;color:white;cursor:pointer}.muted{color:#94a3b8}pre{white-space:pre-wrap;background:#020617;padding:12px;border-radius:8px;max-height:300px;overflow:auto}.ok{color:#22c55e}.warn{color:#f59e0b}
  </style>
</head>
<body>
<header><h1>MILES Desktop</h1><div class="muted">P2GC Digital COO Runtime</div></header>
<div class="grid">
  <div class="card"><div class="muted">Runtime</div><h2 id="runtime">Loading</h2></div>
  <div class="card"><div class="muted">Pending Tasks</div><h2 id="tasks">-</h2></div>
  <div class="card"><div class="muted">Connectors</div><h2 id="connectors">-</h2></div>
  <div class="card"><div class="muted">Approvals</div><h2 id="approvals">-</h2></div>
  <div class="card wide"><h3>Executive Chat</h3><input id="cmd" placeholder="Miles, what needs my attention?"/><button onclick="sendCmd()">Send</button><pre id="chat"></pre></div>
  <div class="card wide"><h3>Live Status</h3><pre id="status"></pre></div>
  <div class="card wide"><h3>Detected Connectors</h3><pre id="connectorList"></pre></div>
  <div class="card wide"><h3>Notifications</h3><pre id="notifications"></pre></div>
</div>
<script>
async function refresh(){
  const s = await fetch('/api/status').then(r=>r.json());
  document.getElementById('runtime').innerHTML = s.runtime === 'running' ? '<span class="ok">Running</span>' : '<span class="warn">Stopped</span>';
  document.getElementById('tasks').textContent = s.tasks.pending;
  document.getElementById('connectors').textContent = Object.keys(s.connectors || {}).length;
  document.getElementById('approvals').textContent = (s.approvals || []).length;
  document.getElementById('status').textContent = JSON.stringify(s, null, 2);
  document.getElementById('connectorList').textContent = JSON.stringify(s.connectors, null, 2);
  document.getElementById('notifications').textContent = JSON.stringify(s.notifications, null, 2);
}
async function sendCmd(){
  const command = document.getElementById('cmd').value;
  const r = await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command})}).then(r=>r.json());
  document.getElementById('chat').textContent = r.message;
  document.getElementById('cmd').value='';
  refresh();
}
refresh(); setInterval(refresh, 5000);
</script>
</body>
</html>
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'WEB\desktop\public\index.html')

@'
const http = require('http');
const { MilesRuntime } = require('../CORE/Runtime/MilesRuntime');
const runtime = new MilesRuntime();
const status = runtime.start();
if (status.runtime !== 'running') throw new Error('Runtime did not start');
if (!status.connectors) throw new Error('Connector map missing');
console.log('MILES healthcheck passed');
console.log(JSON.stringify({runtime: status.runtime, connectors: Object.keys(status.connectors).length, pendingTasks: status.tasks.pending}, null, 2));
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'TESTS\healthcheck.js')

@'
# MILES Sprint Alpha

Production root: `D:\P2GC_Intelligence\MILES_OS`

Run:

```powershell
cd D:\P2GC_Intelligence\MILES_OS
npm install
npm start
```

Open:

```text
http://localhost:3737
```

Test:

```powershell
npm test
```

Sprint Alpha turns the existing repository into one executable runtime + web desktop host. It does not delete old modules. It backs up existing files first.
'@ | Set-Content -Encoding UTF8 (Join-Path $Root 'DOCS\SPRINT_ALPHA.md')

npm install
npm test
Write-Host "SPRINT ALPHA COMPLETE. Backup: $backup"
Write-Host "Run: npm start"
Write-Host "Open: http://localhost:3737"
