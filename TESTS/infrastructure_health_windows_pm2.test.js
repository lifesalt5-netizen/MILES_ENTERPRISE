'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'SERVICES', 'runtime', 'InfrastructureHealthAuditService.js'),
  'utf8'
);

assert(!source.includes("process.platform === 'win32' ? 'pm2.cmd' : 'pm2'"), 'Windows audit must not spawn pm2.cmd directly with shell:false');
assert(source.includes("process.env.ComSpec || 'cmd.exe'"), 'Windows audit should use the command processor for PM2');
assert(source.includes("['/d','/s','/c','pm2','jlist']"), 'Windows PM2 jlist invocation must remain read-only and explicit');

console.log('infrastructure_health_windows_pm2.test.js: PASS');
