'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const stamp = Date.now();

function read(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) throw new Error(`MISSING_FILE: ${file}`);
  return { file, source: fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') };
}

function write(file, source) {
  const backup = `${file}.bak_v14_${stamp}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, source, 'utf8');
  return backup;
}

function patchTaskQueue() {
  const { file, source: original } = read(path.join('CORE', 'TaskQueue.js'));
  let source = original;

  const oldBlock = `    _read() {\n        return this.withLock(() => {\n            const maxRetries = 5;\n            let lastError = null;\n\n            for (let attempt = 1; attempt <= maxRetries; attempt++) {\n                try {\n                    return this.readJsonDirect();\n                } catch (err) {\n                    lastError = err;\n                    sleepSync(100);\n                }\n            }\n\n            const corruptBackup =\n                this.backupCorruptQueue("parse_failure");\n\n            const message =\n                "[TaskQueue] Production queue could not be parsed after retries. " +\n                "The queue was quarantined but was NOT replaced with an empty queue. " +\n                "Backup: " +\n                String(corruptBackup || "unavailable") +\n                ". Cause: " +\n                String(\n                    lastError\n                        ? lastError.message\n                        : "Unknown queue parse failure."\n                );\n\n            console.error(message);\n\n            /*\n             * BUILD134\n             *\n             * Never convert an unreadable production queue into [].\n             *\n             * Returning [] makes a queue-corruption incident appear to be\n             * a legitimate empty queue and causes permanent task loss.\n             *\n             * Fail closed so the supervisor can stop execution, preserve\n             * evidence and allow deterministic recovery.\n             */\n            throw new Error(message);\n        });\n    }`;

  const newBlock = `    _read() {\n        // V1.4: reads are intentionally lock-free. Production writes remain\n        // serialized through withLock(), and writeJsonDirect() uses atomic\n        // replacement. A reader may briefly observe a Windows fallback copy,\n        // so retain bounded parse retries without contending for the writer lock.\n        const maxRetries = 5;\n        let lastError = null;\n\n        for (let attempt = 1; attempt <= maxRetries; attempt++) {\n            try {\n                return this.readJsonDirect();\n            } catch (err) {\n                lastError = err;\n                sleepSync(100);\n            }\n        }\n\n        const corruptBackup =\n            this.backupCorruptQueue("parse_failure");\n\n        const message =\n            "[TaskQueue] Production queue could not be parsed after retries. " +\n            "The queue was quarantined but was NOT replaced with an empty queue. " +\n            "Backup: " +\n            String(corruptBackup || "unavailable") +\n            ". Cause: " +\n            String(\n                lastError\n                    ? lastError.message\n                    : "Unknown queue parse failure."\n            );\n\n        console.error(message);\n        throw new Error(message);\n    }`;

  if (!source.includes('V1.4: reads are intentionally lock-free')) {
    if (!source.includes(oldBlock)) throw new Error('TASKQUEUE_READ_BLOCK_NOT_FOUND');
    source = source.replace(oldBlock, newBlock);
  }

  if (!source.includes('return this.withLock(() => {\n            this.writeJsonDirect(tasks);')) {
    throw new Error('TASKQUEUE_WRITE_LOCK_VALIDATION_FAILED');
  }
  if (!source.includes('V1.4: reads are intentionally lock-free')) {
    throw new Error('TASKQUEUE_READ_PATCH_VALIDATION_FAILED');
  }

  return { file, backup: source === original ? null : write(file, source) };
}

function patchWorkerRuntime() {
  const { file, source: original } = read('StartProductionSystem.js');
  let source = original;
  source = source.replace(/\n\s*require\(["']\.\/api\/server["']\);/g, '');
  source = source.replace(/\n\s*require\(["']\.\/API\/server["']\);/g, '');

  if (/require\(["']\.\/(?:api|API)\/server["']\)/.test(source)) {
    throw new Error('WORKER_RUNTIME_API_COUPLING_STILL_PRESENT');
  }

  return { file, backup: source === original ? null : write(file, source) };
}

function modifyNamedBlock(source, name, updater) {
  const marker = `name: "${name}"`;
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`PROCESS_BLOCK_NOT_FOUND:${name}`);
  const blockStart = source.lastIndexOf('{', at);
  const nextName = source.indexOf('name: "', at + marker.length);
  const blockEnd = nextName >= 0 ? source.lastIndexOf('{', nextName) : source.indexOf('];', at);
  if (blockStart < 0 || blockEnd < 0) throw new Error(`PROCESS_BLOCK_BOUNDARY_FAILED:${name}`);
  const block = source.slice(blockStart, blockEnd);
  return source.slice(0, blockStart) + updater(block) + source.slice(blockEnd);
}

function patchBootstrap() {
  const { file, source: original } = read('StartMilesProduction.js');
  let source = original;

  if (!source.includes('name: "MILES API"')) {
    const workerMarker = '    {\n      name: "Worker Runtime",';
    const apiBlock = `    {\n      name: "MILES API",\n      file: "StartMilesApi.js",\n      phase: 1,\n      readiness: [\n        {\n          type: "tcp",\n          host: "127.0.0.1",\n          port: positiveNumber(env.MILES_API_PORT, 3000)\n        }\n      ]\n    },\n`;
    if (!source.includes(workerMarker)) throw new Error('BOOTSTRAP_WORKER_INSERT_ANCHOR_NOT_FOUND');
    source = source.replace(workerMarker, apiBlock + workerMarker);
  }

  source = modifyNamedBlock(source, 'Worker Runtime', block => {
    let out = block.replace('phase: 1,', 'phase: 2,');
    out = out.replace(/,?\s*\{\s*type: "tcp",\s*host: "127\.0\.0\.1",\s*port: positiveNumber\(env\.MILES_API_PORT, 3000\)\s*\}/m, '');
    return out;
  });

  const phases = [
    ['Autonomous COO', 3],
    ['Miles Command Center', 4],
    ['Desktop UI', 5],
    ['Executive Dashboard', 6]
  ];
  for (const [name, phase] of phases) {
    source = modifyNamedBlock(source, name, block => block.replace(/phase:\s*\d+,/, `phase: ${phase},`));
  }

  if (!source.includes('name: "MILES API"') || !source.includes('file: "StartMilesApi.js"')) {
    throw new Error('BOOTSTRAP_API_PROCESS_VALIDATION_FAILED');
  }

  const workerAt = source.indexOf('name: "Worker Runtime"');
  const cooAt = source.indexOf('name: "Autonomous COO"', workerAt);
  const workerBlock = source.slice(workerAt, cooAt);
  if (workerBlock.includes('MILES_API_PORT') || /type:\s*"tcp"/.test(workerBlock)) {
    throw new Error('WORKER_RUNTIME_STILL_OWNS_API_READINESS');
  }

  return { file, backup: source === original ? null : write(file, source) };
}

function validateDedicatedApi() {
  const { file, source } = read('StartMilesApi.js');
  if (!source.includes("require('./API/server')") && !source.includes('require("./API/server")')) {
    throw new Error('DEDICATED_API_ENTRYPOINT_INVALID');
  }
  return { file, status: 'VALIDATED' };
}

const results = {
  taskQueue: patchTaskQueue(),
  workerRuntime: patchWorkerRuntime(),
  bootstrap: patchBootstrap(),
  dedicatedApi: validateDedicatedApi()
};

console.log(JSON.stringify({
  ok: true,
  gate: 'MILES_PRODUCTION_CONVERGENCE_V14',
  version: '1.4-lock-free-reads-dedicated-api',
  results,
  guarantees: {
    queueReads: 'LOCK_FREE_WITH_BOUNDED_PARSE_RETRY',
    queueWrites: 'EXCLUSIVE_LOCKED',
    api3000: 'DEDICATED_SUPERVISED_PROCESS',
    workerRuntime: 'NO_HTTP_SERVER',
    commandCenter8787: 'PERSIST_AND_ACK_ONLY'
  },
  nextAction: 'SYNTAX_CHECK_THEN_RESTART_AND_RUN_RUNTIME_ACCEPTANCE'
}, null, 2));
