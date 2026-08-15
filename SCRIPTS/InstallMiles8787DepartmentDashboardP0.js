'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const commandCenter = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const indexFile = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'index.html');
const appFile = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'app.js');
const cssFile = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'styles.css');
const serviceFile = path.join(ROOT, 'SERVICES', 'digital_coo', 'DepartmentDashboardService.js');

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.BACKUP_${stamp}`;
  fs.copyFileSync(file, target);
  return target;
}

function replaceOnce(text, needle, replacement, label) {
  if (!text.includes(needle)) throw new Error(`Patch point not found: ${label}`);
  return text.replace(needle, replacement);
}

if (!fs.existsSync(serviceFile)) throw new Error(`Missing ${serviceFile}`);
for (const f of [commandCenter,indexFile,appFile,cssFile]) if (!fs.existsSync(f)) throw new Error(`Missing ${f}`);

const backups = [commandCenter,indexFile,appFile,cssFile].map(backup);

let cc = fs.readFileSync(commandCenter, 'utf8');
if (!cc.includes("DepartmentDashboardService")) {
  cc = replaceOnce(
    cc,
    "const CEOIntentEngineService = require('../CEOIntentEngineService');",
    "const CEOIntentEngineService = require('../CEOIntentEngineService');\nconst DepartmentDashboardService = require('./DepartmentDashboardService');",
    'dashboard require'
  );
  cc = replaceOnce(
    cc,
    "const executiveResponses = new ExecutiveResponseService({\n  rootDir: ROOT\n});",
    "const executiveResponses = new ExecutiveResponseService({\n  rootDir: ROOT\n});\n\nconst departmentDashboard = new DepartmentDashboardService({ rootDir: ROOT });",
    'dashboard instance'
  );
  cc = replaceOnce(
    cc,
    "    if (req.method === 'GET' && req.url === '/') {",
    "    if (req.method === 'GET' && req.url === '/api/dashboard') {\n      try {\n        const snapshot = await departmentDashboard.snapshot();\n        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n        res.end(JSON.stringify(snapshot, null, 2));\n      } catch (error) {\n        log('ERROR', 'Department dashboard failed', { error: error.message });\n        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n        res.end(JSON.stringify({ ok: false, status: 'DASHBOARD_FAILED', error: error.message }, null, 2));\n      }\n      return;\n    }\n\n    if (req.method === 'GET' && req.url === '/') {",
    'dashboard route'
  );
}
fs.writeFileSync(commandCenter, cc, 'utf8');

let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('id="departmentBoard"')) {
  html = replaceOnce(
    html,
    '    <section class="command-panel">',
    `    <section class="dashboard-panel">\n      <div class="panel-heading">\n        <div><div class="eyebrow">LIVE OPERATIONS</div><h2>MILES Departments</h2></div>\n        <button id="refreshAllButton" type="button" class="secondary">Refresh All</button>\n      </div>\n      <div id="dashboardMeta" class="dashboard-meta">Loading live department state...</div>\n      <div id="departmentBoard" class="department-grid"></div>\n    </section>\n\n    <section class="command-panel">`,
    'dashboard html'
  );
}
fs.writeFileSync(indexFile, html, 'utf8');

let app = fs.readFileSync(appFile, 'utf8');
if (!app.includes('refreshDashboard')) {
  app = replaceOnce(
    app,
    '  rawJson: document.getElementById("rawJson")\n};',
    '  rawJson: document.getElementById("rawJson"),\n  refreshAllButton: document.getElementById("refreshAllButton"),\n  departmentBoard: document.getElementById("departmentBoard"),\n  dashboardMeta: document.getElementById("dashboardMeta")\n};',
    'dashboard elements'
  );
  app += `\n\nfunction departmentItem(label, items) {\n  if (!items || !items.length) return '<div class="dept-empty">' + label + ': none</div>';\n  return '<div class="dept-list"><strong>' + label + '</strong>' + items.map(x => '<div class="dept-item"><span>' + escapeHtml(x.title || x.action || 'Operation') + '</span><small>' + escapeHtml(x.status || '') + '</small></div>').join('') + '</div>';\n}\n\nfunction escapeHtml(v) {\n  return String(v || '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));\n}\n\nfunction renderDashboard(data) {\n  if (!elements.departmentBoard) return;\n  const departments = Array.isArray(data.departments) ? data.departments : [];\n  elements.dashboardMeta.textContent = 'Status: ' + (data.status || 'UNKNOWN') + ' • ' + departments.length + ' departments • ' + (data.operationCount || 0) + ' live/recent operations • ' + (data.generatedAt || '');\n  elements.departmentBoard.innerHTML = departments.map(d => {\n    const counts = [\n      ['Running', d.current?.length || 0],['Queued', d.queued?.length || 0],['Approval', d.awaitingApproval?.length || 0],['Blocked', d.blockers?.length || 0]\n    ].map(([k,v]) => '<span class="dept-count">' + k + ': ' + v + '</span>').join('');\n    return '<article class="department-card"><div class="department-card-head"><div><h3>' + escapeHtml(d.name) + '</h3><div class="dept-sub">' + escapeHtml(d.status) + ' • ' + escapeHtml(d.health) + '</div></div><button type="button" class="dept-refresh" data-dept="' + escapeHtml(d.name) + '">Refresh</button></div><div class="dept-counts">' + counts + '</div>' + departmentItem('Now', d.current) + departmentItem('Queued', d.queued) + departmentItem('Awaiting approval', d.awaitingApproval) + departmentItem('Blockers', d.blockers) + departmentItem('Recently completed', d.recentCompleted) + '<div class="dept-last">Last activity: ' + escapeHtml(d.lastActivity || 'No recorded activity') + '</div></article>';\n  }).join('');\n  document.querySelectorAll('.dept-refresh').forEach(btn => btn.addEventListener('click', refreshDashboard));\n}\n\nasync function refreshDashboard() {\n  if (elements.refreshAllButton) elements.refreshAllButton.disabled = true;\n  try {\n    const data = await requestJson('/api/dashboard');\n    renderDashboard(data);\n    try {\n      const health = await requestJson('/api/health');\n      elements.systemStatus.textContent = 'Miles ' + (health.status || (health.ok ? 'HEALTHY' : 'DEGRADED'));\n    } catch {}\n    if (currentOperationId) await pollOperation(currentOperationId);\n  } catch (error) {\n    if (elements.dashboardMeta) elements.dashboardMeta.textContent = 'Dashboard refresh failed: ' + error.message;\n  } finally {\n    if (elements.refreshAllButton) elements.refreshAllButton.disabled = false;\n  }\n}\n\nif (elements.refreshAllButton) elements.refreshAllButton.addEventListener('click', refreshDashboard);\nrefreshDashboard();\nsetInterval(refreshDashboard, 15000);\n`;
}
fs.writeFileSync(appFile, app, 'utf8');

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('.department-grid')) {
  css += `\n\n.dashboard-panel { border:1px solid #253654; background:rgba(14,26,49,.88); border-radius:18px; padding:24px; margin-bottom:20px; }\n.dashboard-meta { color:#9eb0cc; margin:14px 0 18px; font-size:.9rem; }\n.department-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }\n.department-card { border:1px solid #2b3c5c; border-radius:14px; padding:16px; background:#0b1730; min-width:0; }\n.department-card-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }\n.department-card h3 { margin:0 0 4px; font-size:1rem; }\n.dept-sub,.dept-last,.dept-empty { color:#8fa4c4; font-size:.78rem; }\n.dept-refresh { padding:7px 10px; font-size:.72rem; }\n.dept-counts { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0; }\n.dept-count { background:#172641; border-radius:999px; padding:5px 8px; font-size:.7rem; color:#cfe0f8; }\n.dept-list { margin:10px 0; color:#cfe0f8; font-size:.78rem; }\n.dept-item { display:flex; justify-content:space-between; gap:10px; border-top:1px solid #1f3150; padding:6px 0; }\n.dept-item span { overflow-wrap:anywhere; } .dept-item small { color:#93a8c7; white-space:nowrap; }\n@media (max-width:850px){.department-grid{grid-template-columns:1fr;}}\n`;
}
fs.writeFileSync(cssFile, css, 'utf8');

console.log('=== MILES 8787 DEPARTMENT DASHBOARD P0 INSTALLED ===');
console.log('Backups:'); backups.forEach(x => console.log('  ' + x));
console.log('Patched:'); [commandCenter,indexFile,appFile,cssFile].forEach(x => console.log('  ' + x));
console.log('Next: node --check SERVICES/digital_coo/MilesCommandCenter.js');
console.log('Next: node --check SERVICES/digital_coo/DepartmentDashboardService.js');
