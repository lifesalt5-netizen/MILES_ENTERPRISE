'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const runner=fs.readFileSync(path.join(__dirname,'..','SCRIPTS','BuildOrionContractStaging.js'),'utf8');
assert(runner.includes('DEPRECATED_FULL_DATABASE_CLONE_DISABLED_USE_ORION_CONTRACT_SIDECAR_BUILD'));
assert(runner.includes('--explicit-full-clone'));
assert(runner.includes("ORION_ALLOW_FULL_CLONE || ''"));
const bridge=fs.readFileSync(path.join(__dirname,'..','StartMilesRemoteExecutionBridge.js'),'utf8');
assert(bridge.includes('ORION_CONTRACT_STAGING_BUILD'));
console.log('ORION_FULL_CLONE_DISABLED_PRE_REPAIR_TEST_PASS');
