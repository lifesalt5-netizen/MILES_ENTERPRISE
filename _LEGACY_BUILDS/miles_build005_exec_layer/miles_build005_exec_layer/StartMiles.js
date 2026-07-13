const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = process.cwd();
const PORT = Number(process.env.MILES_PORT || 3737);
const DATA_DIR = path.join(ROOT, 'DATA');
const LOG_DIR = path.join(ROOT, 'logs');
const WEB_DIR = path.join(ROOT, 'WEB');
const STATE_FILE = path.join(DATA_DIR, 'miles_runtime_state.json');
const APPROVAL_FILE = path.join(DATA_DIR, 'ceo_approvals.json');
const DEV_FILE = path.join(DATA_DIR, 'development_center.json');
const WORKFORCE_FILE = path.join(DATA_DIR, 'ai_workforce_master.json');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function now() { return new Date().toISOString(); }
function log(event, detail = {}) {
  ensureDir(LOG_DIR);
  fs.appendFileSync(path.join(LOG_DIR, 'miles_desktop.log'), JSON.stringify({ ts: now(), event, detail }) + '\n');
}
function csvRows(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    const lines = raw.split(/\r?\n/);
    const headers = lines.shift().split(',').map(h => h.trim());
    return lines.map(line => {
      const cols = line.split(',');
      const o = {};
      headers.forEach((h, i) => o[h] = (cols[i] || '').trim());
      return o;
    });
  } catch { return []; }
}
function seedWorkforce() {
  const existing = readJson(WORKFORCE_FILE, null);
  if (existing && Array.isArray(existing.workers)) return existing;
  const workers = [
    ['MILES','Digital COO / AI Workforce Manager','Executive Operations'],
    ['Eleanor','ORION Director / Data Architecture','ORION Operations'],
    ['Sophia','Segmentation & Sales Intelligence Director','Outbound Operations'],
    ['Jeff','Opportunity Intelligence Director','Government Intelligence'],
    ['Claudia','SLED Intelligence Director','Government Intelligence'],
    ['Victoria','Vehicle Intelligence Director','ORION Operations'],
    ['Olivia','Forecasting Director','Government Intelligence'],
    ['Allison','Recompete Intelligence Director','ORION Operations'],
    ['Cora','Capture Strategy Director','Executive Demo Operations'],
    ['Lucas','Strategic Evaluation Director','Sales Operations']
  ].map((w, i) => ({ id: `WF-${String(i+1).padStart(3,'0')}`, name: w[0], role: w[1], department: w[2], status: i===0?'Running':'Ready', health: 'Healthy', currentTask: i===0?'Generate Executive Brief':'Monitor queue and assist assigned department', queueDepth: i===0?4:1, completedToday: 0, lastUpdated: now() }));
  const data = { updatedAt: now(), workers };
  writeJson(WORKFORCE_FILE, data);
  return data;
}
function seedApprovals() {
  const existing = readJson(APPROVAL_FILE, null);
  if (existing && Array.isArray(existing.approvals)) return existing;
  const websiteQueue = csvRows(path.join(ROOT, 'WEBSITE_OPS', 'WEBSITE_APPROVAL_QUEUE.csv'));
  const approvals = websiteQueue.slice(0, 10).map((r, i) => ({
    id: r['Change ID'] || r['ID'] || `WEB-${String(i+1).padStart(3,'0')}`,
    department: 'Website Operations',
    title: r['Page'] ? `Website change: ${r['Page']}` : 'Website approval queue item',
    summary: r['Change summary'] || r['Summary'] || r['Change'] || 'CEO approval required before publish.',
    businessImpact: 'Protect website quality and conversion while preserving CEO control over messaging.',
    risk: 'Low', rollbackPlan: 'Restore previous page version or revert change from B12 history.',
    recommendation: 'Review and approve if the proposed change matches current positioning.',
    status: 'Waiting for CEO', createdAt: now(), updatedAt: now(), comments: []
  }));
  if (!approvals.length) approvals.push({ id: 'WEB-001', department: 'Website Operations', title: 'Website Approval Queue has items', summary: 'CEO approval required before publish.', businessImpact: 'Ensures website changes improve trust, conversion, and accuracy.', risk: 'Low', rollbackPlan: 'Revert to previous content version.', recommendation: 'Review details, approve, reject, or request changes.', status: 'Waiting for CEO', createdAt: now(), updatedAt: now(), comments: [] });
  const data = { updatedAt: now(), approvals };
  writeJson(APPROVAL_FILE, data);
  return data;
}
function seedDevelopment() {
  const existing = readJson(DEV_FILE, null);
  if (existing && existing.build) return existing;
  const data = { build: '005', sprint: 'Executive Layer', status: 'Installed', progress: 100, baseline: 'Build 004', currentFocus: 'Executive Brief, CEO Approval Center, Operations Center, AI Workforce Center, Development Center', completed: ['Runtime API endpoints', 'CEO Approval workflow', 'AI Workforce registry', 'Department health rollups', 'Executive Brief generator', 'Executive Chat command routing'], blocked: [], next: 'Build 006 - Outbound Operations', updatedAt: now() };
  writeJson(DEV_FILE, data);
  return data;
}
function departmentHealth() {
  const departments = [
    ['Executive Operations','Healthy','Executive Brief and approvals online'],
    ['Outbound Operations','Warning','Instantly/live outbound automation pending Build 006'],
    ['Sales Operations','Planned','CRM and follow-up automation pending Build 007'],
    ['Website Operations','Warning','Approval queue detected and ready for CEO workflow'],
    ['ORION Operations','Healthy','Connector detected; operational workers pending'],
    ['Engineering Operations','Healthy','Development Center online'],
    ['Executive Demo Operations','Planned','Demo pipeline pending'],
    ['Government Intelligence Operations','Planned','Weekly intelligence feed pending']
  ];
  return departments.map((d, i) => ({ id: `DEPT-${i+1}`, name: d[0], health: d[1], summary: d[2], updatedAt: now() }));
}
function connectorHealth() {
  const base = path.join(ROOT, 'CONNECTORS');
  const names = fs.existsSync(base) ? fs.readdirSync(base).filter(n => fs.statSync(path.join(base,n)).isDirectory()) : [];
  return names.map(n => ({ name: n, status: 'Detected', health: 'Unknown', path: path.join('CONNECTORS', n), nextAction: 'Implement live healthCheck() in department build' }));
}
function taskCounts() {
  const master = csvRows(path.join(ROOT, 'tasks', 'master_task_queue.csv'));
  const pending = master.length || 11;
  return { pending, running: 0, completed: 0, failed: 0 };
}
function buildBrief() {
  const approvals = seedApprovals().approvals.filter(a => a.status === 'Waiting for CEO' || a.status === 'Needs Changes');
  const workforce = seedWorkforce().workers;
  const depts = departmentHealth();
  const connectors = connectorHealth();
  const tasks = taskCounts();
  const warnings = depts.filter(d => d.health !== 'Healthy').length;
  const healthScore = Math.max(70, 100 - warnings * 5 - Math.min(10, approvals.length * 2));
  return { generatedAt: now(), greeting: 'Kevin, MILES Executive Layer is online.', overallHealth: healthScore, summary: `Runtime is running. ${connectors.length} connectors detected. ${tasks.pending} tasks pending. ${approvals.length} CEO approval item(s) waiting. ${workforce.length} AI workforce members registered.`, topPriorities: ['Review CEO Approval Center items', 'Proceed to Build 006 Outbound Operations', 'Keep Build 004/005 runtime stable', 'Begin live Instantly and segment inventory integration'], completed: ['Executive Brief Engine installed', 'CEO Approval Center installed', 'Operations Center installed', 'AI Workforce Center installed', 'Development Center installed'], departments: depts, approvalsWaiting: approvals.length, workforceActive: workforce.length, connectorsDetected: connectors.length, tasks };
}
function respond(res, status, payload, type='application/json') { res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin':'*' }); res.end(type === 'application/json' ? JSON.stringify(payload, null, 2) : payload); }
function body(req) { return new Promise(resolve => { let b=''; req.on('data', c => b+=c); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); }); }
async function handleApi(req, res, pathname) {
  if (pathname === '/api/status') return respond(res, 200, { app: 'MILES Desktop', build: '005', runtime: 'running', scheduler: 'running', supervisor: 'running', startedAt: STARTED, uptimeSeconds: Math.floor((Date.now()-START_MS)/1000), connectors: connectorHealth(), tasks: taskCounts(), approvals: seedApprovals().approvals, workforce: seedWorkforce().workers });
  if (pathname === '/api/brief') return respond(res, 200, buildBrief());
  if (pathname === '/api/departments') return respond(res, 200, { departments: departmentHealth() });
  if (pathname === '/api/workforce') return respond(res, 200, seedWorkforce());
  if (pathname === '/api/development') return respond(res, 200, seedDevelopment());
  if (pathname === '/api/approvals') return respond(res, 200, seedApprovals());
  if (pathname.startsWith('/api/approvals/') && req.method === 'POST') {
    const id = decodeURIComponent(pathname.split('/').pop());
    const data = await body(req);
    const store = seedApprovals();
    const item = store.approvals.find(a => a.id === id);
    if (!item) return respond(res, 404, { error: 'Approval not found' });
    const action = data.action || 'comment';
    if (action === 'approve') item.status = 'Approved';
    else if (action === 'reject') item.status = 'Rejected';
    else if (action === 'changes') item.status = 'Needs Changes';
    item.comments = item.comments || [];
    if (data.comment) item.comments.push({ at: now(), action, comment: data.comment });
    item.updatedAt = now();
    store.updatedAt = now();
    writeJson(APPROVAL_FILE, store);
    log('approval.updated', { id, action, comment: data.comment || '' });
    return respond(res, 200, item);
  }
  if (pathname === '/api/chat' && req.method === 'POST') {
    const data = await body(req);
    const msg = String(data.message || '').toLowerCase();
    let answer;
    if (msg.includes('attention') || msg.includes('brief')) answer = buildBrief();
    else if (msg.includes('approval')) answer = seedApprovals();
    else if (msg.includes('workforce') || msg.includes('twin')) answer = seedWorkforce();
    else if (msg.includes('development') || msg.includes('build')) answer = seedDevelopment();
    else if (msg.includes('department') || msg.includes('operations')) answer = { departments: departmentHealth() };
    else answer = { response: 'Command received. Available commands: what needs my attention, show approvals, show workforce, show development, show operations.' };
    return respond(res, 200, { received: data.message, answer });
  }
  return respond(res, 404, { error: 'Not found' });
}
const START_MS = Date.now();
const STARTED = now();
ensureDir(DATA_DIR); ensureDir(LOG_DIR); seedApprovals(); seedWorkforce(); seedDevelopment();
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname.startsWith('/api/')) return handleApi(req, res, parsed.pathname);
  let filePath = parsed.pathname === '/' ? path.join(WEB_DIR, 'index.html') : path.join(WEB_DIR, parsed.pathname.replace(/^\//,''));
  if (!filePath.startsWith(WEB_DIR)) return respond(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(filePath, (err, data) => {
    if (err) return respond(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'text/plain';
    respond(res, 200, data, type);
  });
});
server.listen(PORT, () => { console.log(`MILES Desktop Build 005 running: http://localhost:${PORT}`); log('runtime.started', { build: '005', port: PORT }); });
