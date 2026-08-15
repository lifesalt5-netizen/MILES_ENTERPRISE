'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const target = path.join(ROOT, 'SERVICES', 'digital_coo', 'DigitalCOORuntimeManager.js');
const stateFile = path.join(ROOT, 'runtime', 'digital_coo', 'digital_coo_runtime_manager_state.json');

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup(file, suffix) {
  if (!fs.existsSync(file)) return null;
  const out = `${file}.${suffix}_${stamp()}`;
  fs.copyFileSync(file, out);
  return out;
}

if (!fs.existsSync(target)) throw new Error(`Missing runtime manager: ${target}`);

const sourceBackup = backup(target, 'BEFORE_STATE_EXPLOSION_P0');
const stateBackup = backup(stateFile, 'BEFORE_STATE_EXPLOSION_P0');

let text = fs.readFileSync(target, 'utf8');

const oldPersist = `  persistState() {\n    this.state.generatedAt = new Date().toISOString();\n    fs.writeFileSync(this.statePath, JSON.stringify(this.getState(), null, 2), 'utf8');\n  }`;

const newPersist = `  compactValue(value, depth = 0, seen = new WeakSet()) {\n    if (value == null) return value;\n\n    const type = typeof value;\n\n    if (type === 'string') {\n      return value.length > 4000\n        ? value.slice(0, 4000) + '...[TRUNCATED]'\n        : value;\n    }\n\n    if (type === 'number' || type === 'boolean') return value;\n    if (type === 'bigint') return String(value);\n    if (type === 'function') return '[FUNCTION]';\n\n    if (depth >= 5) {\n      if (Array.isArray(value)) return '[ARRAY_TRUNCATED depth=' + depth + ' length=' + value.length + ']';\n      return '[OBJECT_TRUNCATED depth=' + depth + ']';\n    }\n\n    if (type === 'object') {\n      if (seen.has(value)) return '[CIRCULAR]';\n      seen.add(value);\n\n      if (Array.isArray(value)) {\n        return value.slice(0, 25).map(item =>\n          this.compactValue(item, depth + 1, seen)\n        );\n      }\n\n      const out = {};\n      const entries = Object.entries(value).slice(0, 60);\n      for (const [key, item] of entries) {\n        out[key] = this.compactValue(item, depth + 1, seen);\n      }\n      return out;\n    }\n\n    return String(value);\n  }\n\n  getPersistableState() {\n    const snapshot = {\n      ...this.state,\n      lastOperation: this.compactValue(this.state.lastOperation),\n      lastHealth: this.compactValue(this.state.lastHealth),\n      lastExecutiveSummary: this.compactValue(this.state.lastExecutiveSummary),\n      lastResult: this.compactValue(this.state.lastResult),\n      running: this.running,\n      generatedAt: new Date().toISOString()\n    };\n\n    return snapshot;\n  }\n\n  persistState() {\n    this.state.generatedAt = new Date().toISOString();\n    const snapshot = this.getPersistableState();\n    fs.writeFileSync(this.statePath, JSON.stringify(snapshot, null, 2), 'utf8');\n  }`;

if (!text.includes(oldPersist)) {
  throw new Error('Expected persistState() block not found; local file differs from inspected version.');
}

text = text.replace(oldPersist, newPersist);

const oldGetState = `  getState() {\n    return {\n      ...this.state,\n      running: this.running,\n      generatedAt: new Date().toISOString()\n    };\n  }`;

const newGetState = `  getState() {\n    return this.getPersistableState();\n  }`;

if (!text.includes(oldGetState)) {
  throw new Error('Expected getState() block not found; local file differs from inspected version.');
}

text = text.replace(oldGetState, newGetState);
fs.writeFileSync(target, text, 'utf8');

if (fs.existsSync(stateFile)) {
  try {
    const existing = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const cleaned = {
      ok: existing.ok !== false,
      service: existing.service || 'DIGITAL_COO_RUNTIME_MANAGER',
      version: existing.version || '1.0.0',
      status: 'STATE_COMPACTED_FOR_RECOVERY',
      startedAt: existing.startedAt || null,
      stoppedAt: existing.stoppedAt || null,
      lastCycleAt: existing.lastCycleAt || null,
      cycleCount: Number(existing.cycleCount || 0),
      operationsQueued: Number(existing.operationsQueued || 0),
      operationsProcessed: Number(existing.operationsProcessed || 0),
      operationsCompleted: Number(existing.operationsCompleted || 0),
      operationsFailed: Number(existing.operationsFailed || 0),
      operationsRejected: Number(existing.operationsRejected || 0),
      recoveriesAttempted: Number(existing.recoveriesAttempted || 0),
      recoveriesCompleted: Number(existing.recoveriesCompleted || 0),
      executiveSummariesGenerated: Number(existing.executiveSummariesGenerated || 0),
      lastOperationAt: existing.lastOperationAt || null,
      lastHealthAt: existing.lastHealthAt || null,
      lastExecutiveSummaryAt: existing.lastExecutiveSummaryAt || null,
      lastOperation: null,
      lastHealth: null,
      lastExecutiveSummary: null,
      lastResult: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(stateFile, JSON.stringify(cleaned, null, 2), 'utf8');
  } catch (error) {
    fs.writeFileSync(stateFile, JSON.stringify({
      ok: false,
      service: 'DIGITAL_COO_RUNTIME_MANAGER',
      version: '1.0.0',
      status: 'STATE_RESET_AFTER_PARSE_FAILURE',
      cycleCount: 0,
      operationsQueued: 0,
      operationsProcessed: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      operationsRejected: 0,
      recoveriesAttempted: 0,
      recoveriesCompleted: 0,
      executiveSummariesGenerated: 0,
      lastOperation: null,
      lastHealth: null,
      lastExecutiveSummary: null,
      lastResult: null,
      lastError: error.message,
      generatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  }
}

console.log('=== DIGITAL COO RUNTIME STATE EXPLOSION REPAIR P0 ===');
console.log('source:', target);
console.log('source_backup:', sourceBackup || '(none)');
console.log('state_backup:', stateBackup || '(none)');
console.log('state_file:', stateFile);
console.log('status: PATCHED_AND_COMPACTED');
