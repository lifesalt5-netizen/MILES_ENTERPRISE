'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RuntimeRegistryService = require('../SERVICES/runtime_registry/RuntimeRegistryService');

async function main() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-runtime-v2-'));

  const service = new RuntimeRegistryService({
    rootDir,
    port: 0,
    pollIntervalMs: 60000
  });

  const registered = service.register({
    id: 'TEST_WORKER',
    name: 'Test Worker',
    type: 'WORKER',
    status: 'RUNNING',
    capabilities: ['TEST_CAPABILITY'],
    pid: 1234
  });

  assert(registered.ok);
  assert.strictEqual(service.get('TEST_WORKER').status, 'RUNNING');
  assert.strictEqual(
    service.getCapabilityProviders('TEST_CAPABILITY').length,
    1
  );

  service.heartbeat('TEST_WORKER', {
    status: 'HEALTHY'
  });

  assert.strictEqual(service.get('TEST_WORKER').status, 'HEALTHY');

  service.deregister('TEST_WORKER', 'Test complete.');

  assert.strictEqual(service.get('TEST_WORKER').status, 'DOWN');

  assert(
    fs.existsSync(
      path.join(
        rootDir,
        'runtime',
        'runtime_registry_v2',
        'runtime_registry.json'
      )
    )
  );

  console.log('PASS: Runtime Registry Service V2 test completed.');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
