'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ComponentRegistry = require('../SERVICES/registry/EnterpriseComponentRegistryService');
const CapabilityRegistry = require('../SERVICES/registry/EnterpriseCapabilityRegistryService');

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-registry-test-'));
fs.mkdirSync(path.join(rootDir, 'SERVICES', 'workers'), { recursive: true });

fs.writeFileSync(
  path.join(rootDir, 'SERVICES', 'workers', 'TestWorker.js'),
  `
  class TestWorker {
    constructor() {
      this.supportedActions = ['TEST_ACTION', 'RUN_HEALTH_CHECK'];
      this.approvalRequiredActions = ['TEST_ACTION'];
    }
  }
  module.exports = TestWorker;
  `,
  'utf8'
);

const component = new ComponentRegistry({ rootDir });
const result = component.scan();

assert(result.ok);
assert(result.componentCount >= 1);

const capability = new CapabilityRegistry({ rootDir });
const capabilityResult = capability.build();

assert(capabilityResult.ok);
assert(capabilityResult.capabilityCount >= 1);

const resolved = capability.resolve('TEST_ACTION');
assert(resolved.ok);
assert(resolved.preferredProvider);

console.log('PASS: Enterprise registry test completed.');
