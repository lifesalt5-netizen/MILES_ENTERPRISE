'use strict';

const RuntimeRegistryClient = require('./SERVICES/runtime_registry/RuntimeRegistryClient');

const registry = new RuntimeRegistryClient();

async function main() {
  await registry.register({
    id: 'EXAMPLE_WORKER',
    name: 'Example Worker',
    type: 'WORKER',
    version: '1.0.0',
    status: 'RUNNING',
    pid: process.pid,
    capabilities: ['EXAMPLE_ACTION']
  });

  const heartbeat = setInterval(() => {
    registry.heartbeat('EXAMPLE_WORKER', {
      status: 'RUNNING',
      pid: process.pid
    }).catch(() => {});
  }, 30000);

  heartbeat.unref();

  const shutdown = async () => {
    try {
      await registry.deregister('EXAMPLE_WORKER', 'Process stopped.');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('Example worker registered.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
