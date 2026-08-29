'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'digital_coo', 'UnifiedMilesGateway.js'), 'utf8');

assert(source.includes("/request-changes$/"), 'Unified gateway must expose a request-changes route');
assert(source.includes('CHANGES_REQUESTED_BY_CEO'), 'Original operation must be stopped with an explicit CEO changes-requested reason');
assert(source.includes("'/reject'"), 'Request Changes must use the canonical reject endpoint to stop the original governed operation');
assert(source.includes("internalJsonRequest(COMMAND_PORT, '/api/command'"), 'Request Changes must dispatch a revision mission back to MILES');
assert(source.includes("status: 'CHANGES_REQUESTED'"), 'Request Changes must return a semantic CHANGES_REQUESTED status');
assert(source.includes('originalStopped: true'), 'Request Changes response must prove the original was stopped');
assert(!source.includes('business_operations_queue.json'), 'Gateway must not create a second direct queue writer');

console.log('unified_gateway_request_changes.test.js: PASS');
