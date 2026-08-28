'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--root') out.root = argv[++i];
    else if (value === '--proof-id') out.proofId = argv[++i];
    else if (value === '--delay-seconds') out.delaySeconds = Number(argv[++i]);
    else throw new Error(`UNEXPECTED_ARG:${value}`);
  }
  return out;
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function readTail(file, maxChars = 2400) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.slice(-maxChars).replace(/[\r\n]+/g, ' | ').trim();
  } catch {
    return '';
  }
}

async function launch(options) {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  const root = path.resolve(String(options.root || ''));
  const proofId = String(options.proofId || '');
  const delaySeconds = Number(options.delaySeconds);
  if (!root || !fs.existsSync(path.join(root, '.git'))) throw new Error(`MILES_ROOT_NOT_FOUND:${root}`);
  if (!/^[a-f0-9]{32}$/i.test(proofId)) throw new Error('PROOF_ID_INVALID');
  if (!Number.isInteger(delaySeconds) || delaySeconds < 10 || delaySeconds > 180) throw new Error('RECOVERY_PROOF_DELAY_OUT_OF_RANGE');

  const proofScript = path.join(root, 'SCRIPTS', 'RunMilesControlOwnerRecoveryProofWindows.ps1');
  if (!fs.existsSync(proofScript)) throw new Error(`RECOVERY_PROOF_SCRIPT_NOT_FOUND:${proofScript}`);

  const runtimeDir = path.join(root, 'DATA', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const logFile = path.join(runtimeDir, `control_owner_recovery_proof_launch_${proofId}.log`);
  const logFd = fs.openSync(logFile, 'a');
  let child;
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', proofScript,
      '-Root', root,
      '-ProofId', proofId,
      '-DelaySeconds', String(delaySeconds)
    ], {
      cwd: root,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('DETACHED_RECOVERY_PROOF_SPAWN_TIMEOUT'));
      }, 3000);
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      child.once('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    try { fs.closeSync(logFd); } catch {}
  }

  child.unref();
  await new Promise(resolve => setTimeout(resolve, 1250));
  const pidAlive = isPidAlive(child.pid);
  if (!pidAlive) {
    const tail = readTail(logFile);
    throw new Error(`DETACHED_RECOVERY_PROOF_NOT_ALIVE:exit=${child.exitCode === null ? 'UNKNOWN' : child.exitCode}:log=${tail || 'EMPTY'}`);
  }
  return { pid: child.pid, logFile };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const launched = await launch(options);
  process.stdout.write(`RECOVERY_PROOF_LAUNCH_PID=${launched.pid}\n`);
  process.stdout.write(`RECOVERY_PROOF_LAUNCH_LOG=${launched.logFile}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  });
}

module.exports = { parseArgs, isPidAlive, readTail, launch, main };
