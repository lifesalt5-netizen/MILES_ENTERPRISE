'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const { parentPort, workerData } = require('worker_threads');

const rootDir = path.resolve(workerData?.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
const term = String(workerData?.term || '').trim();
const refresh = workerData?.refresh === true;
const childScript = path.join(__dirname, 'P2GCGrowthModelChild.js');
const maxConcurrency = Math.min(2, Math.max(1, Number(process.env.P2GC_GROWTH_WORKER_MAX_CONCURRENCY || 1)));
const childHeapMb = Math.max(512, Number(process.env.P2GC_GROWTH_CHILD_MAX_OLD_SPACE_MB || 1536));
const gateBase = path.join(rootDir, 'DATA', 'runtime', 'p2gc-growth-model-worker');
const gateFiles = Array.from({ length:maxConcurrency }, (_, index) => `${gateBase}.${index}.lock`);
const gatePollMs = Math.max(100, Number(process.env.P2GC_GROWTH_WORKER_GATE_POLL_MS || 250));
const gateStaleMs = Math.max(60000, Number(process.env.P2GC_GROWTH_WORKER_GATE_STALE_MS || 300000));
let gateFd = null;
let gateFile = null;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function staleGate(candidate) {
  try {
    const stat = fs.statSync(candidate);
    return Date.now() - stat.mtimeMs > gateStaleMs;
  } catch {
    return false;
  }
}

async function acquireGate() {
  fs.mkdirSync(path.dirname(gateBase), { recursive:true });
  for (;;) {
    for (const candidate of gateFiles) {
      try {
        const fd = fs.openSync(candidate, 'wx');
        gateFd = fd;
        gateFile = candidate;
        fs.writeFileSync(fd, JSON.stringify({ pid:process.pid, term, acquiredAt:new Date().toISOString(), host:os.hostname(), maxConcurrency, mode:'CHILD_PROCESS_ISOLATION' }));
        return;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (staleGate(candidate)) {
          try { fs.unlinkSync(candidate); } catch {}
        }
      }
    }
    await sleep(gatePollMs);
  }
}

function releaseGate() {
  if (gateFd !== null) {
    try { fs.closeSync(gateFd); } catch {}
    gateFd = null;
  }
  if (gateFile) {
    try { fs.unlinkSync(gateFile); } catch {}
    gateFile = null;
  }
}

function runChildModel() {
  return new Promise((resolve, reject) => {
    if (!term) return resolve({ ok:false, status:'TERM_REQUIRED' });
    let settled = false;
    let stderr = '';
    const child = fork(childScript, [], {
      cwd: rootDir,
      env: {
        ...process.env,
        P2GC_GROWTH_CHILD_ROOT: rootDir,
        P2GC_GROWTH_CHILD_TERM: term,
        P2GC_GROWTH_CHILD_REFRESH: refresh ? '1' : '0'
      },
      execArgv: [`--max-old-space-size=${childHeapMb}`],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true
    });
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try { child.disconnect(); } catch {}
      try { child.kill(); } catch {}
      fn(value);
    };
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
    });
    child.once('message', message => {
      if (message?.ok === true) return finish(resolve, message.model);
      finish(reject, new Error(message?.error || 'MODEL_CHILD_FAILED'));
    });
    child.once('error', error => finish(reject, error));
    child.once('exit', (code, signal) => {
      if (!settled) finish(reject, new Error(`MODEL_CHILD_EXIT_${code ?? 'NULL'}_${signal || 'NONE'}:${stderr}`));
    });
  });
}

async function buildModel() {
  await acquireGate();
  try {
    return await runChildModel();
  } finally {
    releaseGate();
  }
}

buildModel()
  .then(model => parentPort.postMessage({ ok:true, model }))
  .catch(error => {
    releaseGate();
    parentPort.postMessage({ ok:false, error:String(error?.stack || error?.message || error) });
  });
