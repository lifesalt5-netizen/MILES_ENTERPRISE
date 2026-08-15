'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const managerFile = path.join(ROOT, 'SERVICES', 'digital_coo', 'DigitalCOORuntimeManager.js');
const stateFile = path.join(ROOT, 'runtime', 'digital_coo', 'digital_coo_runtime_manager_state.json');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const out = `${file}.BEFORE_STATE_COMPACTION_${stamp()}`;
  fs.copyFileSync(file, out);
  return out;
}

function compactValue(value, depth = 0, seen = new WeakSet()) {
  const MAX_DEPTH = 4;
  const MAX_ARRAY = 25;
  const MAX_KEYS = 40;
  const MAX_STRING = 4000;

  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '...[truncated]' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return String(value);

  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[max-depth]';
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map(v => compactValue(v, depth + 1, seen));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }

  const out = {};
  const keys = Object.keys(value).slice(0, MAX_KEYS);
  for (const key of keys) {
    try {
      out[key] = compactValue(value[key], depth + 1, seen);
    } catch (error) {
      out[key] = `[unserializable:${error.message}]`;
    }
  }
  if (Object.keys(value).length > MAX_KEYS) {
    out.__truncatedKeys = Object.keys(value).length - MAX_KEYS;
  }
  return out;
}

if (!fs.existsSync(managerFile)) throw new Error(`Missing manager file: ${managerFile}`);

const managerBackup = backup(managerFile);
let text = fs.readFileSync(managerFile, 'utf8');

if (!text.includes('compactStateForPersistence(')) {
  const marker = '  persistState() {';
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error('persistState() method not found');

  const helper = `  compactStateForPersistence(value, depth = 0, seen = new WeakSet()) {\n    const MAX_DEPTH = 4;\n    const MAX_ARRAY = 25;\n    const MAX_KEYS = 40;\n    const MAX_STRING = 4000;\n\n    if (value == null) return value;\n    if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '...[truncated]' : value;\n    if (typeof value === 'number' || typeof value === 'boolean') return value;\n    if (typeof value === 'bigint') return value.toString();\n    if (typeof value === 'function') return '[function]';\n    if (typeof value !== 'object') return String(value);\n    if (seen.has(value)) return '[circular]';\n    if (depth >= MAX_DEPTH) return '[max-depth]';\n    seen.add(value);\n\n    if (Array.isArray(value)) {\n      const out = value.slice(0, MAX_ARRAY).map(item => this.compactStateForPersistence(item, depth + 1, seen));\n      if (value.length > MAX_ARRAY) out.push('[+' + (value.length - MAX_ARRAY) + ' more]');\n      return out;\n    }\n\n    const out = {};\n    const keys = Object.keys(value).slice(0, MAX_KEYS);\n    for (const key of keys) {\n      try {\n        out[key] = this.compactStateForPersistence(value[key], depth + 1, seen);\n      } catch (error) {\n        out[key] = '[unserializable:' + error.message + ']';\n      }\n    }\n    if (Object.keys(value).length > MAX_KEYS) out.__truncatedKeys = Object.keys(value).length - MAX_KEYS;\n    return out;\n  }\n\n`;

  text = text.slice(0, idx) + helper + text.slice(idx);
}

const start = text.indexOf('  persistState() {');
if (start < 0) throw new Error('persistState() start not found after helper insertion');
const nextMethod = text.indexOf('\n  appendJsonLine(', start);
if (nextMethod < 0) throw new Error('appendJsonLine() boundary not found');

const replacement = `  persistState() {\n    this.state.generatedAt = new Date().toISOString();\n    const compact = this.compactStateForPersistence(this.getState());\n    const serialized = JSON.stringify(compact, null, 2);\n    fs.writeFileSync(this.statePath, serialized, 'utf8');\n  }\n`;

text = text.slice(0, start) + replacement + text.slice(nextMethod);
fs.writeFileSync(managerFile, text, 'utf8');

let stateBackup = null;
let stateSizeBefore = null;
let stateSizeAfter = null;

if (fs.existsSync(stateFile)) {
  stateBackup = backup(stateFile);
  stateSizeBefore = fs.statSync(stateFile).size;
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    const compacted = compactValue(parsed);
    fs.writeFileSync(stateFile, JSON.stringify(compacted, null, 2), 'utf8');
    stateSizeAfter = fs.statSync(stateFile).size;
  } catch (error) {
    fs.writeFileSync(stateFile, JSON.stringify({
      ok: false,
      service: 'DIGITAL_COO_RUNTIME_MANAGER',
      status: 'STATE_RESET_AFTER_OVERSIZE_OR_PARSE_FAILURE',
      lastError: error.message,
      generatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    stateSizeAfter = fs.statSync(stateFile).size;
  }
}

console.log('=== DIGITAL COO RUNTIME STATE EXPLOSION REPAIR P0 V2 ===');
console.log('manager patched:', managerFile);
console.log('manager backup:', managerBackup);
console.log('state file:', stateFile);
console.log('state backup:', stateBackup || 'none');
if (stateSizeBefore != null) console.log('state bytes before:', stateSizeBefore);
if (stateSizeAfter != null) console.log('state bytes after:', stateSizeAfter);
console.log('next: node --check SERVICES\\digital_coo\\DigitalCOORuntimeManager.js');
