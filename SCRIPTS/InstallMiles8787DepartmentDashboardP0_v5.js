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
  const out = `${file}.BEFORE_8787_DEPARTMENTS_V5_${stamp()}`;
  fs.copyFileSync(file, out);
  return out;
}

function appendBefore(text, marker, insertion, label) {
  const idx = text.lastIndexOf(marker);
  if (idx < 0) throw new Error(`Patch point not found: ${label}`);
  return text.slice(0, idx) + insertion + '\n' + text.slice(idx);
}

for (const file of [indexFile, appFile, cssFile]) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
}

const backups = [backup(indexFile), backup(appFile), backup(cssFile)];

let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('id="departmentBoard"')) {
  const board = [
    '',
    '<section class="miles-departments" id="departmentBoardSection">',
    '  <div class="miles-departments-header">',
    '    <div>',
    '      <div class="eyebrow">LIVE COO OPERATIONS</div>',
    '      <h2>Department Status</h2>',
    '      <p id="departmentBoardStatus">Loading live MILES departments...</p>',
    '    </div>',
    '    <button type="button" id="refreshAllDepartments" class="secondary">Refresh All</button>',
    '  </div>',
    '  <div id="departmentBoard" class="department-grid"></div>',
    '</section>',
    ''
  ].join('\n');
  html = appendBefore(html, '</main>', board, 'index </main>');
  fs.writeFileSync(indexFile, html, 'utf8');
}

let js = fs.readFileSync(appFile, 'utf8');
if (!js.includes('async function refreshDepartmentBoard')) {
  const lines = [
    '',
    '',
    '// P0 live MILES department dashboard',
    "function deptEl(id) { return document.getElementById(id); }",
    '',
    'function esc(value) {',
    "  return String(value == null ? '' : value)",
    "    .replace(/&/g, '&amp;')",
    "    .replace(/</g, '&lt;')",
    "    .replace(/>/g, '&gt;')",
    "    .replace(/\"/g, '&quot;');",
    '}',
    '',
    'function numberValue(obj, keys) {',
    '  for (const key of keys) {',
    '    if (obj && obj[key] != null && Number.isFinite(Number(obj[key]))) return Number(obj[key]);',
    '  }',
    '  return 0;',
    '}',
    '',
    'function renderDepartmentBoard(data) {',
    "  const board = deptEl('departmentBoard');",
    "  const status = deptEl('departmentBoardStatus');",
    '  if (!board) return;',
    '',
    '  const departments = Array.isArray(data && data.departments) ? data.departments : [];',
    '  const generatedAt = data && (data.generatedAt || data.checkedAt || data.timestamp);',
    '  if (status) {',
    "    status.textContent = generatedAt ? 'Live snapshot: ' + new Date(generatedAt).toLocaleString() : 'Live snapshot loaded';",
    '  }',
    '',
    '  if (!departments.length) {',
    "    board.innerHTML = '<div class=\"department-empty\">No department records were returned by MILES.</div>';",
    '    return;',
    '  }',
    '',
    '  board.innerHTML = departments.map(function(dep) {',
    "    const name = dep.name || dep.department || dep.id || 'Unnamed Department';",
    "    const health = dep.health || dep.status || dep.runtimeStatus || 'UNKNOWN';",
    '    const current = dep.currentWork || dep.running || dep.active || [];',
    '    const blockers = dep.blockers || dep.errors || [];',
    "    const queued = numberValue(dep, ['queued','queueCount','pending']);",
    "    const running = numberValue(dep, ['runningCount','running','activeCount']);",
    "    const completed = numberValue(dep, ['completed','completedCount']);",
    "    const failed = numberValue(dep, ['failed','failedCount']);",
    "    const approval = numberValue(dep, ['awaitingApproval','approvalCount']);",
    "    const lastActivity = dep.lastActivity || dep.updatedAt || dep.lastUpdated || dep.generatedAt || '';",
    "    const currentText = Array.isArray(current) ? current.slice(0,3).map(function(x){ return typeof x === 'string' ? x : (x.title || x.command || x.action || x.id || ''); }).filter(Boolean).join(' | ') : String(current || '');",
    "    const blockerText = Array.isArray(blockers) ? blockers.slice(0,2).map(function(x){ return typeof x === 'string' ? x : (x.message || x.error || x.title || ''); }).filter(Boolean).join(' | ') : String(blockers || '');",
    "    const healthClass = esc(String(health).toLowerCase().replace(/[^a-z0-9]+/g,'_'));",
    '',
    '    return [',
    "      '<article class=\"department-card\">',",
    "      '  <div class=\"department-card-head\">',",
    "      '    <h3>' + esc(name) + '</h3>',",
    "      '    <span class=\"dept-health ' + healthClass + '\">' + esc(health) + '</span>',",
    "      '  </div>',",
    "      '  <div class=\"department-metrics\">',",
    "      '    <span><b>' + queued + '</b> queued</span>',",
    "      '    <span><b>' + running + '</b> running</span>',",
    "      '    <span><b>' + completed + '</b> completed</span>',",
    "      '    <span><b>' + failed + '</b> failed</span>',",
    "      '    <span><b>' + approval + '</b> approval</span>',",
    "      '  </div>',",
    "      '  <div class=\"department-detail\"><strong>Current:</strong> ' + esc(currentText || 'No active work reported') + '</div>',",
    "      '  <div class=\"department-detail\"><strong>Blockers:</strong> ' + esc(blockerText || 'None reported') + '</div>',",
    "      '  <div class=\"department-foot\">',",
    "      '    <span>' + (lastActivity ? 'Last activity: ' + esc(lastActivity) : 'No activity timestamp') + '</span>',",
    "      '    <button type=\"button\" class=\"secondary dept-refresh\" data-department=\"' + esc(name) + '\">Refresh</button>',",
    "      '  </div>',",
    "      '</article>'",
    "    ].join('');",
    "  }).join('');",
    '',
    "  board.querySelectorAll('.dept-refresh').forEach(function(button) {",
    "    button.addEventListener('click', function() { refreshDepartmentBoard(button.dataset.department || ''); });",
    '  });',
    '}',
    '',
    "async function refreshDepartmentBoard(department = '') {",
    "  const status = deptEl('departmentBoardStatus');",
    "  const button = deptEl('refreshAllDepartments');",
    "  if (status) status.textContent = department ? 'Refreshing ' + department + '...' : 'Refreshing all MILES departments...';",
    '  if (button) button.disabled = true;',
    '  try {',
    "    const url = department ? '/api/dashboard?department=' + encodeURIComponent(department) : '/api/dashboard';",
    "    const response = await fetch(url, { cache: 'no-store' });",
    '    const data = await response.json();',
    "    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || 'Dashboard refresh failed');",
    '    renderDepartmentBoard(data);',
    '  } catch (error) {',
    "    if (status) status.textContent = 'Dashboard refresh failed: ' + error.message;",
    '  } finally {',
    '    if (button) button.disabled = false;',
    '  }',
    '}',
    '',
    "window.addEventListener('DOMContentLoaded', function() {",
    "  const refreshAll = deptEl('refreshAllDepartments');",
    "  if (refreshAll) refreshAll.addEventListener('click', function() { refreshDepartmentBoard(); });",
    '  refreshDepartmentBoard();',
    '});',
    ''
  ];
  js += lines.join('\n');
  fs.writeFileSync(appFile, js, 'utf8');
}

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('.miles-departments')) {
  css += [
    '',
    '',
    '/* P0 live department dashboard */',
    '.miles-departments { margin-top:24px; border:1px solid #253654; border-radius:18px; padding:24px; background:rgba(14,26,49,.88); }',
    '.miles-departments-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:18px; }',
    '.miles-departments-header h2 { margin:4px 0 4px; }',
    '.miles-departments-header p { margin:0; color:#9eb0cc; }',
    '.department-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px; }',
    '.department-card { border:1px solid #2b3d5d; border-radius:14px; padding:16px; background:#0b1730; }',
    '.department-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }',
    '.department-card-head h3 { margin:0; font-size:1rem; }',
    '.dept-health { border-radius:999px; padding:5px 9px; font-size:.7rem; font-weight:900; background:rgba(255,188,66,.15); color:#ffd073; }',
    '.dept-health.healthy,.dept-health.ready,.dept-health.online { background:rgba(32,201,111,.15); color:#62e59c; }',
    '.dept-health.failed,.dept-health.error,.dept-health.degraded,.dept-health.offline { background:rgba(239,83,80,.15); color:#ff8b88; }',
    '.department-metrics { display:flex; flex-wrap:wrap; gap:8px 12px; margin:14px 0; color:#aebed7; font-size:.8rem; }',
    '.department-metrics b { color:#f3f7ff; }',
    '.department-detail { margin:7px 0; color:#c8d5e8; font-size:.86rem; line-height:1.4; }',
    '.department-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:13px; padding-top:12px; border-top:1px solid #243552; color:#8295b3; font-size:.75rem; }',
    '.dept-refresh { padding:7px 10px; font-size:.75rem; }',
    '.department-empty { color:#9eb0cc; padding:16px 0; }',
    '@media (max-width:700px){ .miles-departments-header,.department-foot{display:block}.miles-departments-header button,.department-foot button{margin-top:10px}.department-grid{grid-template-columns:1fr} }',
    ''
  ].join('\n');
  fs.writeFileSync(cssFile, css, 'utf8');
}

console.log('=== MILES 8787 DEPARTMENT DASHBOARD P0 V5 ===');
console.log('UI patch installed without nested template literals.');
console.log('Backups:');
backups.forEach(file => console.log('  ' + file));
console.log('index:', indexFile);
console.log('app:', appFile);
console.log('css:', cssFile);
