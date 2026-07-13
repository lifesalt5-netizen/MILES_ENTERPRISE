'use strict';

const path = require('path');
const RuntimeRegistryService = require('./SERVICES/runtime_registry/RuntimeRegistryService');

const rootDir = process.env.MILES_ROOT
  ? path.resolve(process.env.MILES_ROOT)
  : __dirname;

const service = new RuntimeRegistryService({ rootDir });

async function shutdown(signal) {
  console.log(`[RUNTIME REGISTRY] Received ${signal}. Shutting down.`);
  try {
    await service.stop();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

service.start()
  .then(result => {
    console.log('============================================================');
    console.log('MILES RUNTIME REGISTRY SERVICE V2 ONLINE');
    console.log('============================================================');
    console.log(`Health:   http://${result.host}:${result.port}/health`);
    console.log(`Services: http://${result.host}:${result.port}/services`);
    console.log(`PID:      ${result.pid}`);
    console.log('Press Ctrl+C to stop.');
  })
  .catch(error => {
    console.error('RUNTIME REGISTRY SERVICE FAILED');
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
