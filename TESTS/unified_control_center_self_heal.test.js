'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInfrastructureHealthAudit.js'), 'utf8');

assert(source.includes("'miles-command-center'"), 'Self-heal target must be fixed to miles-command-center');
assert(source.includes("latestSourceMs > uptimeMs + 1000"), 'Restart must only occur when source is newer or process is unhealthy');
assert(source.includes("['/d','/s','/c','pm2','restart','miles-command-center','--update-env']"), 'Restart command must be explicit and allowlisted');
assert(source.includes("httpJson(8787, '/api/health'"), 'Self-heal must verify public gateway health');
assert(source.includes('controlPlaneRestartOnlyWhenSourceNewer: true'), 'Evidence must state the source-age restart guard');
assert(!source.includes('pm2 delete'), 'Self-heal must never delete PM2 apps');
assert(!source.includes('git reset'), 'Self-heal must not perform destructive Git recovery');

console.log('unified_control_center_self_heal.test.js: PASS');
