'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cc = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const app = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'app.js');
const html = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'index.html');
const css = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'styles.css');

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function backup(file) {
  const target = `${file}.BEFORE_8787_DEPARTMENTS_${stamp()}`;
  fs.copyFileSync(file, target);
  return target;
}

function replaceRegex(text, regex, replacement, label) {
  if (!regex.test(text)) throw new Error(`Patch point not found: ${label}`);
  return text.replace(regex, replacement);
}

function ensureOnce(text, needle, insertion) {
  if (text.includes(insertion.trim())) return text;
  const idx = text.indexOf(needle);
  if (idx < 0) throw new Error(`Patch point not found: ${needle}`);
  return text.slice(0, idx) + insertion + text.slice(idx);
}

for (const file of [cc, app, html, css]) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
}

console.log('Backups:');
for (const file of [cc, app, html, css]) console.log('  ' + backup(file));

let s = fs.readFileSync(cc, 'utf8');
if (!s.includes("require('./DepartmentDashboardService')")) {
  s = replaceRegex(
    s,
    /(const\s+DigitalCOOHost\s*=\s*require\('\.\/DigitalCOOHost'\);)/,
    `$1\nconst DepartmentDashboardService = require('./DepartmentDashboardService');`,
    'dashboard require'
  );
}

if (!/const\s+departmentDashboard\s*=\s*new\s+DepartmentDashboardService/.test(s)) {
  s = replaceRegex(
    s,
    /(const\s+host\s*=\s*new\s+DigitalCOOHost\s*\([\s\S]*?\n\}\);)/,
    `$1\n\nconst departmentDashboard = new DepartmentDashboardService({ rootDir: ROOT });`,
    'dashboard instance'
  );
}

if (!s.includes("req.url === '/api/dashboard'")) {
  s = replaceRegex(
    s,
    /(if\s*\(req\.method\s*===\s*'GET'\s*&&\s*req\.url\s*===\s*'\/api\/health'\)\s*\{)/,
    `if (req.method === 'GET' && req.url === '/api/dashboard') {\n      try {\n        const dashboard = await departmentDashboard.snapshot();\n        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n        res.end(JSON.stringify(dashboard, null, 2));\n      } catch (error) {\n        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n        res.end(JSON.stringify({ ok: false, status: 'DASHBOARD_FAILED', error: error.message }, null, 2));\n      }\n      return;\n    }\n\n    $1`,
    'dashboard route'
  );
}
fs.writeFileSync(cc, s, 'utf8');

let h = fs.readFileSync(html, 'utf8');
if (!h.includes('id="refreshAllButton"')) {
  h = replaceRegex(
    h,
    /(<div class="system-status">[\s\S]*?<\/div>)/,
    `$1\n      <button id="refreshAllButton" type="button" class="secondary">Refresh All</button>`,
    'refresh all button'
  );
}
if (!h.includes('id="departmentBoard"')) {
  h = replaceRegex(
    h,
    /(<section class="command-panel">)/,
    `<section class="department-panel">\n      <div class="panel-heading">\n        <div><div class="eyebrow">LIVE OPERATIONS</div><h2>Departments</h2></div>\n        <span id="dashboardUpdatedAt" class="dashboard-updated">Not refreshed</span>\n      </div>\n      <div id="departmentBoard" class="department-grid"></div>\n    </section>\n\n    $1`,
    'department board'
  );
}
fs.writeFileSync(html, h, 'utf8');

let a = fs.readFileSync(app, 'utf8');
if (!a.includes('refreshAllButton: document.getElementById("refreshAllButton")')) {
  a = replaceRegex(
    a,
    /(refreshButton:\s*document\.getElementById\("refreshButton"\),)/,
    `$1\n  refreshAllButton: document.getElementById("refreshAllButton"),\n  departmentBoard: document.getElementById("departmentBoard"),\n  dashboardUpdatedAt: document.getElementById("dashboardUpdatedAt"),`,
    'app element registry'
  );
}
if (!a.includes('async function refreshDashboard()')) {
  a += `\n\nfunction renderDepartmentBoard(data) {\n  const board = elements.departmentBoard;\n  if (!board) return;\n  board.innerHTML = '';\n  const departments = Array.isArray(data.departments) ? data.departments : [];\n  for (const dept of departments) {\n    const card = document.createElement('article');\n    card.className = 'department-card';\n    const counts = dept.counts || {};\n    card.innerHTML = '<div class="department-card-head"><strong></strong><span class="badge"></span></div>' +\n      '<div class="department-metrics"></div><div class="department-current"></div>';\n    card.querySelector('strong').textContent = dept.name || dept.department || 'Unknown';\n    const badge = card.querySelector('.badge');\n    badge.textContent = normalizeStatus(dept.health || dept.status || 'UNKNOWN');\n    badge.className = 'badge ' + badgeClass(badge.textContent);\n    card.querySelector('.department-metrics').textContent =\n      'Running ' + (counts.running || 0) + ' • Queued ' + (counts.queued || 0) +\n      ' • Blocked ' + (counts.blocked || 0) + ' • Approval ' + (counts.awaitingApproval || 0) +\n      ' • Failed ' + (counts.failed || 0);\n    const current = Array.isArray(dept.currentWork) ? dept.currentWork.slice(0, 3) : [];\n    card.querySelector('.department-current').textContent = current.length\n      ? current.map(x => x.title || x.command || x.id || 'work').join(' | ')\n      : 'No active work';\n    board.appendChild(card);\n  }\n  if (!departments.length) board.textContent = 'No department data available.';\n  if (elements.dashboardUpdatedAt) elements.dashboardUpdatedAt.textContent = data.generatedAt || 'Refreshed';\n}\n\nasync function refreshDashboard() {\n  try {\n    const data = await requestJson('/api/dashboard');\n    renderDepartmentBoard(data);\n    if (data.health && data.health.status) elements.systemStatus.textContent = 'Miles ' + data.health.status.toLowerCase();\n  } catch (error) {\n    if (elements.departmentBoard) elements.departmentBoard.textContent = 'Dashboard refresh failed: ' + error.message;\n    elements.systemStatus.textContent = 'Dashboard refresh failed';\n  }\n}\n\nif (elements.refreshAllButton) {\n  elements.refreshAllButton.addEventListener('click', async () => {\n    await refreshDashboard();\n    if (currentOperationId) await pollOperation(currentOperationId);\n  });\n}\n\nrefreshDashboard();\nsetInterval(refreshDashboard, 15000);\n`;
}
fs.writeFileSync(app, a, 'utf8');

let c = fs.readFileSync(css, 'utf8');
if (!c.includes('.department-grid')) {
  c += `\n.department-panel { margin: 20px 0; border: 1px solid #253654; background: rgba(14,26,49,.88); border-radius:18px; padding:24px; }\n.department-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-top:18px; }\n.department-card { border:1px solid #2a3b5a; border-radius:14px; padding:16px; background:#0b1730; min-height:140px; }\n.department-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }\n.department-metrics { color:#a9bad2; font-size:.84rem; line-height:1.45; }\n.department-current { margin-top:10px; color:#eef4ff; font-size:.88rem; line-height:1.45; }\n.dashboard-updated { color:#8295b3; font-size:.78rem; }\n@media (max-width:900px){ .department-grid{grid-template-columns:repeat(2,minmax(0,1fr));} }\n@media (max-width:600px){ .department-grid{grid-template-columns:1fr;} }\n`;
}
fs.writeFileSync(css, c, 'utf8');

console.log('P0 V3 dashboard patch installed.');
console.log('Next: node --check on MilesCommandCenter.js + app.js, then regression test.');
