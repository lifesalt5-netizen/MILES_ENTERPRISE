'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const uiDir = path.join(ROOT, 'SERVICES', 'digital_coo', 'public');
const indexFile = path.join(uiDir, 'index.html');
const appFile = path.join(uiDir, 'app.js');
const cssFile = path.join(uiDir, 'styles.css');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup(file) {
  const out = `${file}.BEFORE_8787_DEPARTMENTS_V4_${stamp()}`;
  fs.copyFileSync(file, out);
  return out;
}

function appendBefore(text, marker, insertion, label) {
  const idx = text.lastIndexOf(marker);
  if (idx < 0) throw new Error(`Patch point not found: ${label}`);
  return text.slice(0, idx) + insertion + '\n' + text.slice(idx);
}

for (const f of [indexFile, appFile, cssFile]) {
  if (!fs.existsSync(f)) throw new Error(`Missing required file: ${f}`);
}

const backups = [backup(indexFile), backup(appFile), backup(cssFile)];

let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('id="departmentBoard"')) {
  const board = `\n<section class="miles-departments" id="departmentBoardSection">\n  <div class="miles-departments-header">\n    <div>\n      <div class="eyebrow">LIVE COO OPERATIONS</div>\n      <h2>Department Status</h2>\n      <p id="departmentBoardStatus">Loading live MILES departments...</p>\n    </div>\n    <button type="button" id="refreshAllDepartments" class="secondary">Refresh All</button>\n  </div>\n  <div id="departmentBoard" class="department-grid"></div>\n</section>\n`;
  html = appendBefore(html, '</main>', board, 'index </main>');
  fs.writeFileSync(indexFile, html, 'utf8');
}

let js = fs.readFileSync(appFile, 'utf8');
if (!js.includes('async function refreshDepartmentBoard')) {
  const patch = `\n\n// P0 live MILES department dashboard\nfunction deptEl(id) { return document.getElementById(id); }\n\nfunction esc(value) {\n  return String(value == null ? '' : value)\n    .replace(/&/g, '&amp;')\n    .replace(/</g, '&lt;')\n    .replace(/>/g, '&gt;')\n    .replace(/\"/g, '&quot;');\n}\n\nfunction numberValue(obj, keys) {\n  for (const key of keys) {\n    if (obj && obj[key] != null && Number.isFinite(Number(obj[key]))) return Number(obj[key]);\n  }\n  return 0;\n}\n\nfunction renderDepartmentBoard(data) {\n  const board = deptEl('departmentBoard');\n  const status = deptEl('departmentBoardStatus');\n  if (!board) return;\n\n  const departments = Array.isArray(data && data.departments) ? data.departments : [];\n  const generatedAt = data && (data.generatedAt || data.checkedAt || data.timestamp);\n  status.textContent = generatedAt\n    ? 'Live snapshot: ' + new Date(generatedAt).toLocaleString()\n    : 'Live snapshot loaded';\n\n  if (!departments.length) {\n    board.innerHTML = '<div class="department-empty">No department records were returned by MILES.</div>';\n    return;\n  }\n\n  board.innerHTML = departments.map(dep => {\n    const name = dep.name || dep.department || dep.id || 'Unnamed Department';\n    const health = dep.health || dep.status || dep.runtimeStatus || 'UNKNOWN';\n    const current = dep.currentWork || dep.running || dep.active || [];\n    const blockers = dep.blockers || dep.errors || [];\n    const queued = numberValue(dep, ['queued','queueCount','pending']);\n    const running = numberValue(dep, ['runningCount','running','activeCount']);\n    const completed = numberValue(dep, ['completed','completedCount']);\n    const failed = numberValue(dep, ['failed','failedCount']);\n    const approval = numberValue(dep, ['awaitingApproval','approvalCount']);\n    const lastActivity = dep.lastActivity || dep.updatedAt || dep.lastUpdated || dep.generatedAt || '';\n    const currentText = Array.isArray(current)\n      ? current.slice(0, 3).map(x => typeof x === 'string' ? x : (x.title || x.command || x.action || x.id || '')).filter(Boolean).join(' • ')\n      : String(current || '');\n    const blockerText = Array.isArray(blockers)\n      ? blockers.slice(0, 2).map(x => typeof x === 'string' ? x : (x.message || x.error || x.title || '')).filter(Boolean).join(' • ')\n      : String(blockers || '');\n\n    return `<article class="department-card">\n      <div class="department-card-head">\n        <h3>${esc(name)}</h3>\n        <span class="dept-health ${esc(String(health).toLowerCase().replace(/[^a-z0-9]+/g,'_'))}">${esc(health)}</span>\n      </div>\n      <div class="department-metrics">\n        <span><b>${queued}</b> queued</span>\n        <span><b>${running}</b> running</span>\n        <span><b>${completed}</b> completed</span>\n        <span><b>${failed}</b> failed</span>\n        <span><b>${approval}</b> approval</span>\n      </div>\n      <div class="department-detail"><strong>Current:</strong> ${esc(currentText || 'No active work reported')}</div>\n      <div class="department-detail"><strong>Blockers:</strong> ${esc(blockerText || 'None reported')}</div>\n      <div class="department-foot">\n        <span>${lastActivity ? 'Last activity: ' + esc(lastActivity) : 'No activity timestamp'}</span>\n        <button type="button" class="secondary dept-refresh" data-department="${esc(name)}">Refresh</button>\n      </div>\n    </article>`;\n  }).join('');\n\n  board.querySelectorAll('.dept-refresh').forEach(button => {\n    button.addEventListener('click', () => refreshDepartmentBoard(button.dataset.department || ''));\n  });\n}\n\nasync function refreshDepartmentBoard(department = '') {\n  const status = deptEl('departmentBoardStatus');\n  const button = deptEl('refreshAllDepartments');\n  if (status) status.textContent = department ? `Refreshing ${department}...` : 'Refreshing all MILES departments...';\n  if (button) button.disabled = true;\n  try {\n    const url = department ? '/api/dashboard?department=' + encodeURIComponent(department) : '/api/dashboard';\n    const response = await fetch(url, { cache: 'no-store' });\n    const data = await response.json();\n    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || 'Dashboard refresh failed');\n    renderDepartmentBoard(data);\n  } catch (error) {\n    if (status) status.textContent = 'Dashboard refresh failed: ' + error.message;\n  } finally {\n    if (button) button.disabled = false;\n  }\n}\n\nwindow.addEventListener('DOMContentLoaded', () => {\n  const refreshAll = deptEl('refreshAllDepartments');\n  if (refreshAll) refreshAll.addEventListener('click', () => refreshDepartmentBoard());\n  refreshDepartmentBoard();\n});\n`;
  js += patch;
  fs.writeFileSync(appFile, js, 'utf8');
}

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('.miles-departments')) {
  css += `\n\n/* P0 live department dashboard */\n.miles-departments { margin-top: 24px; border: 1px solid #253654; border-radius: 18px; padding: 24px; background: rgba(14,26,49,.88); }\n.miles-departments-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:18px; }\n.miles-departments-header h2 { margin:4px 0 4px; }\n.miles-departments-header p { margin:0; color:#9eb0cc; }\n.department-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }\n.department-card { border:1px solid #2b3d5d; border-radius:14px; padding:16px; background:#0b1730; }\n.department-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }\n.department-card-head h3 { margin:0; font-size:1rem; }\n.dept-health { border-radius:999px; padding:5px 9px; font-size:.7rem; font-weight:900; background:rgba(255,188,66,.15); color:#ffd073; }\n.dept-health.healthy,.dept-health.ready,.dept-health.online { background:rgba(32,201,111,.15); color:#62e59c; }\n.dept-health.failed,.dept-health.error,.dept-health.degraded,.dept-health.offline { background:rgba(239,83,80,.15); color:#ff8b88; }\n.department-metrics { display:flex; flex-wrap:wrap; gap:8px 12px; margin:14px 0; color:#aebed7; font-size:.8rem; }\n.department-metrics b { color:#f3f7ff; }\n.department-detail { margin:7px 0; color:#c8d5e8; font-size:.86rem; line-height:1.4; }\n.department-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:13px; padding-top:12px; border-top:1px solid #243552; color:#8295b3; font-size:.75rem; }\n.dept-refresh { padding:7px 10px; font-size:.75rem; }\n.department-empty { color:#9eb0cc; padding:16px 0; }\n@media (max-width:700px){ .miles-departments-header,.department-foot{display:block}.miles-departments-header button,.department-foot button{margin-top:10px}.department-grid{grid-template-columns:1fr} }\n`;
  fs.writeFileSync(cssFile, css, 'utf8');
}

console.log('=== MILES 8787 DEPARTMENT DASHBOARD P0 V4 ===');
console.log('UI patched against actual local shape.');
console.log('Backups:');
backups.forEach(x => console.log('  ' + x));
console.log('index:', indexFile);
console.log('app:', appFile);
console.log('css:', cssFile);
