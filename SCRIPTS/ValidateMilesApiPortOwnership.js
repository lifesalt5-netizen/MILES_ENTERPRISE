'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'StartProductionSystem.js'), 'utf8');
const apiLauncher = fs.readFileSync(path.join(root, 'SCRIPTS', 'StartMilesApi.js'), 'utf8');

const workerStartsApi = /require\(["']\.\/api\/server["']\)/.test(worker);
const dedicatedLauncherStartsApi = /require\(["']\.\.\/API\/server["']\)/.test(apiLauncher);

if (workerStartsApi) {
  console.error('RED: StartProductionSystem.js starts API/server. miles-api must exclusively own port 3000.');
  process.exit(1);
}

if (!dedicatedLauncherStartsApi) {
  console.error('RED: SCRIPTS/StartMilesApi.js does not start ../API/server.');
  process.exit(1);
}

console.log('GREEN: dedicated miles-api is the only MILES startup path that owns API/server.');
