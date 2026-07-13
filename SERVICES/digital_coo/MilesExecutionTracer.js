'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function exists(file) {
  return fs.existsSync(file);
}

function tail(file, lines = 20) {
  try {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

function report() {
  const stateDir = path.join(ROOT, 'state');
  const runtimeDir = path.join(ROOT, 'runtime');
  const logsDir = path.join(ROOT, 'logs');

  const businessQueue = path.join(stateDir, 'business_operations_queue.json');
  const hostQueue = path.join(stateDir, 'digital_coo_host_operation_queue.json');
  const workerState = path.join(runtimeDir, 'worker_runtime_state.json');
  const workerExecLog = path.join(runtimeDir, 'worker_execution_log.jsonl');
  const connectorState = path.join(runtimeDir, 'connector_runtime_state.json');
  const connectorExecLog = path.join(runtimeDir, 'connector_execution_log.jsonl');

  const business = readJson(businessQueue, { operations: [] });
  const host = readJson(hostQueue, { operations: [] });
  const worker = readJson(workerState, {});
  const connector = readJson(connectorState, {});

  const output = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    queues: {
      businessOperationsQueue: {
        exists: exists(businessQueue),
        path: businessQueue,
        count: Array.isArray(business.operations) ? business.operations.length : 0,
        latest: Array.isArray(business.operations) ? business.operations[0] || null : null
      },
      hostOperationQueue: {
        exists: exists(hostQueue),
        path: hostQueue,
        count: Array.isArray(host.operations) ? host.operations.length : 0,
        latest: Array.isArray(host.operations) ? host.operations[host.operations.length - 1] || null : null
      }
    },
    workerRuntime: {
      stateExists: exists(workerState),
      status: worker.status || null,
      workersDiscovered: worker.workersDiscovered || 0,
      workersAvailable: worker.workersAvailable || 0,
      workersRunning: worker.workersRunning || 0,
      workersCompleted: worker.workersCompleted || 0,
      workersFailed: worker.workersFailed || 0,
      lastExecutionAt: worker.lastExecutionAt || null,
      lastError: worker.lastError || null
    },
    connectorRuntime: {
      stateExists: exists(connectorState),
      status: connector.status || null,
      connectorsDiscovered: connector.connectorsDiscovered || 0,
      connectorsLoaded: connector.connectorsLoaded || 0,
      connectorsFailed: connector.connectorsFailed || 0,
      lastExecutionAt: connector.lastExecutionAt || null,
      lastError: connector.lastError || null
    },
    logs: {
      workerExecutionLog: {
        exists: exists(workerExecLog),
        tail: tail(workerExecLog, 10)
      },
      connectorExecutionLog: {
        exists: exists(connectorExecLog),
        tail: tail(connectorExecLog, 10)
      },
      commandCenterLog: {
        exists: exists(path.join(logsDir, 'miles_command_center.log')),
        tail: tail(path.join(logsDir, 'miles_command_center.log'), 10)
      },
      digitalCOOHostLog: {
        exists: exists(path.join(logsDir, 'digital_coo_host.log')),
        tail: tail(path.join(logsDir, 'digital_coo_host.log'), 10)
      }
    },
    diagnosis: []
  };

  if (output.queues.businessOperationsQueue.count > 0 && output.workerRuntime.lastExecutionAt === null) {
    output.diagnosis.push('Operations exist, but Worker Runtime has not executed work yet.');
  }

  if (output.queues.hostOperationQueue.count > 0 && output.workerRuntime.lastExecutionAt === null) {
    output.diagnosis.push('Host accepted operations, but no worker execution has occurred.');
  }

  if (output.workerRuntime.workersAvailable > 0 && output.workerRuntime.lastExecutionAt === null) {
    output.diagnosis.push('Workers are discovered and available, but queue-to-worker dispatch is not yet consuming operations.');
  }

  if (output.connectorRuntime.connectorsLoaded === 0) {
    output.diagnosis.push('Connector Runtime is healthy but has no loaded connectors yet.');
  }

  console.log(JSON.stringify(output, null, 2));
}

report();