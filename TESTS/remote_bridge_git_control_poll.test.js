'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'StartMilesRemoteExecutionBridge.js');
const text = fs.readFileSync(file, 'utf8');
assert(text.includes("const DIRECTIVE_REPO_PATH = 'DATA/control/miles_remote_execution_directive.json'"));
assert(text.includes("gitRun(['ls-remote', 'origin', ref]"));
assert(text.includes("gitRun(['fetch', '--quiet', 'origin'"));
assert(text.includes("gitRun(['show', `${sha}:${DIRECTIVE_REPO_PATH}`]"));
assert(text.includes('controlDirectiveCache'));
assert(text.includes('CONTROL-GIT fallback'));
assert(text.includes('const directive = await getDirective();'));
assert(!text.includes('git reset --hard'));
console.log('REMOTE_BRIDGE_GIT_CONTROL_POLL_CONTRACT_PASS');
