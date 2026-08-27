'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunIonosInboxCleanup.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'StartMilesRemoteExecutionBridge.js'), 'utf8');

assert(runner.includes("IonosAllFolderReconciliationService"));
assert(!runner.includes("new IonosInboxCleanupService"));
assert(runner.includes("process.argv.includes('--execute')"));
assert(runner.includes('IONOS_ALL_FOLDER_RECONCILIATION_PLAN_GREEN'));
assert(runner.includes('IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_GREEN'));
assert(bridge.includes("IONOS_INBOX_CLEANUP_PLAN: ['node', ['SCRIPTS/RunIonosInboxCleanup.js']]"));
assert(bridge.includes("IONOS_INBOX_CLEANUP_EXECUTE: ['node', ['SCRIPTS/RunIonosInboxCleanup.js', '--execute']]"));
assert(!runner.includes('EXPUNGE'));
assert(!runner.includes('\\Deleted'));
console.log('IONOS_ALL_FOLDER_REMOTE_LANE=PASS');
