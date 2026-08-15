'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const commandCenter = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const indexHtml = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'index.html');
const appJs = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'app.js');
const stylesCss = path.join(ROOT, 'SERVICES', 'digital_coo', 'public', 'styles.css');
const backupDir = path.join(ROOT, 'recovery', 'miles8787_dashboard_p0_v2_' + Date.now());

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text, 'utf8'); }
function ensure(file) { if (!fs.existsSync(file)) throw new Error('Missing required file: ' + file); }
function backup(file) {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
}
function insertAfter(text, needle, addition, label) {
  if (text.includes(addition.trim())) return text;
  const idx = text.indexOf(needle);
  if (idx < 0) throw new Error('Patch point not found: ' + label);
  return text.slice(0, idx + needle.length) + addition + text.slice(idx + needle.length);
}
function insertBefore(text, needle, addition, label) {
  if (text.includes(addition.trim())) return text;
  const idx = text.indexOf(needle);
  if (idx < 0) throw new Error('Patch point not found: ' + label);
  return text.slice(0, idx) + addition + text.slice(idx);
}

[commandCenter, indexHtml, appJs, stylesCss].forEach(ensure);
[commandCenter, indexHtml, appJs, stylesCss].forEach(backup);

let cc = read(commandCenter);
cc = insertAfter(
  cc,
  "const DigitalCOOHost = require('./DigitalCOOHost');",
  "\nconst DepartmentDashboardService = require('./DepartmentDashboardService');",
  'dashboard require'
);
cc = insertAfter(
  cc,
  "const executiveResponses = new ExecutiveResponseService({\n  rootDir: ROOT\n});",
  "\n\nconst departmentDashboard = new DepartmentDashboardService({\n  rootDir: ROOT,\n  host\n});",
  'dashboard instance'
);
cc = insertBefore(
  cc,
  "    if (req.method === 'GET' && req.url === '/') {",
  "    if (req.method === 'GET' && req.url.startsWith('/api/dashboard')) {\n      try {\n        const url = new URL(req.url, `http://localhost:${PORT}`);\n        const department = url.searchParams.get('department');\n        const dashboard = await departmentDashboard.snapshot({ department });\n        res.writeHead(200, {\n          'Content-Type': 'application/json',\n          'Cache-Control': 'no-store'\n        });\n        res.end(JSON.stringify(dashboard, null, 2));\n      } catch (error) {\n        log('ERROR', 'Dashboard snapshot failed', { error: error.message });\n        res.writeHead(500, {\n          'Content-Type': 'application/json',\n          'Cache-Control': 'no-store'\n        });\n        res.end(JSON.stringify({ ok: false, status: 'DASHBOARD_FAILED', error: error.message }, null, 2));\n      }\n      return;\n    }\n\n",
  'dashboard route'
);
write(commandCenter, cc);

let html = read(indexHtml);
html = insertBefore(
  html,
  '    <section class="command-panel">',
  `    <section class="dashboard-panel">\n      <div class="panel-heading">\n        <div>\n          <div class="eyebrow">LIVE OPERATIONS</div>\n          <h2>Departments</h2>\n        </div>\n        <button id="refreshAllButton" type="button" class="secondary">Refresh All</button>\n      </div>\n      <div id="dashboardSummary" class="dashboard-summary">Loading live MILES status...</div>\n      <div id="departmentBoard" class="department-board"></div>\n    </section>\n\n`,
  'department dashboard html'
);
write(indexHtml, html);

let app = read(appJs);
app = insertAfter(
  app,
  '  rawJson: document.getElementById("rawJson")',
  ',\n  refreshAllButton: document.getElementById("refreshAllButton"),\n  dashboardSummary: document.getElementById("dashboardSummary"),\n  departmentBoard: document.getElementById("departmentBoard")',
  'dashboard element refs'
);
app = insertBefore(
  app,
  'function clearCommand() {',
  `async function refreshDashboard(department = "") {\n  if (!elements.departmentBoard) return;\n  try {\n    const suffix = department ? "?department=" + encodeURIComponent(department) : "";\n    const data = await requestJson("/api/dashboard" + suffix);\n    const departments = Array.isArray(data.departments) ? data.departments : [];\n    const summary = data.summary || {};\n    elements.dashboardSummary.textContent =\n      "Departments: " + (summary.departmentCount ?? departments.length) +\n      " | Active: " + (summary.active ?? 0) +\n      " | Queued: " + (summary.queued ?? 0) +\n      " | Blocked: " + (summary.blocked ?? 0) +\n      " | Awaiting approval: " + (summary.awaitingApproval ?? 0) +\n      " | Updated: " + (data.generatedAt || "unknown");\n    elements.departmentBoard.innerHTML = "";\n    for (const dept of departments) {\n      const card = document.createElement("article");\n      card.className = "department-card";\n      const title = document.createElement("div");\n      title.className = "department-card-title";\n      title.textContent = dept.name || dept.department || "Department";\n      const status = document.createElement("div");\n      status.className = "department-card-status";\n      status.textContent = (dept.health || dept.status || "UNKNOWN").toString().toUpperCase();\n      const body = document.createElement("div");\n      body.className = "department-card-body";\n      const counts = dept.counts || {};\n      body.textContent =\n        "Running " + (counts.running ?? 0) +\n        " · Queued " + (counts.queued ?? 0) +\n        " · Failed " + (counts.failed ?? 0) +\n        " · Approval " + (counts.awaitingApproval ?? 0) +\n        (dept.lastActivity ? " · Last " + dept.lastActivity : "");\n      const actions = document.createElement("div");\n      actions.className = "department-card-actions";\n      const button = document.createElement("button");\n      button.type = "button";\n      button.className = "secondary compact";\n      button.textContent = "Refresh";\n      button.addEventListener("click", () => refreshDashboard(dept.name || dept.department || ""));\n      actions.appendChild(button);\n      card.append(title, status, body, actions);\n      elements.departmentBoard.appendChild(card);\n    }\n  } catch (error) {\n    elements.dashboardSummary.textContent = "Dashboard refresh failed: " + error.message;\n  }\n}\n\n`,
  'dashboard refresh function'
);
app = insertAfter(
  app,
  'elements.clearButton.addEventListener("click", clearCommand);',
  '\nif (elements.refreshAllButton) {\n  elements.refreshAllButton.addEventListener("click", () => refreshDashboard());\n}',
  'refresh all binding'
);
app = insertBefore(
  app,
  'setBadge("READY");',
  'refreshDashboard();\n\n',
  'initial dashboard refresh'
);
write(appJs, app);

let css = read(stylesCss);
if (!css.includes('.department-board')) {
  css += `\n.dashboard-panel {\n  margin-bottom: 20px;\n  border: 1px solid #253654;\n  background: rgba(14, 26, 49, 0.88);\n  border-radius: 18px;\n  padding: 24px;\n}\n.dashboard-summary { color: #9eb0cc; margin: 16px 0; line-height: 1.5; }\n.department-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }\n.department-card { border: 1px solid #2a3d5f; border-radius: 14px; padding: 16px; background: #0b1730; }\n.department-card-title { font-weight: 850; margin-bottom: 7px; }\n.department-card-status { color: #62e59c; font-size: .78rem; font-weight: 900; letter-spacing: .08em; margin-bottom: 10px; }\n.department-card-body { color: #a9bad4; font-size: .9rem; line-height: 1.5; }\n.department-card-actions { margin-top: 12px; }\nbutton.compact { padding: 8px 12px; font-size: .82rem; }\n@media (max-width: 900px) { .department-board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }\n@media (max-width: 600px) { .department-board { grid-template-columns: 1fr; } }\n`;
}
write(stylesCss, css);

console.log('=== MILES 8787 DEPARTMENT DASHBOARD P0 V2 INSTALLED ===');
console.log('backupDir:', backupDir);
console.log('patched:', commandCenter);
console.log('patched:', indexHtml);
console.log('patched:', appJs);
console.log('patched:', stylesCss);
console.log('next: run node --check on MilesCommandCenter.js, DepartmentDashboardService.js, public/app.js');
