'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const DepartmentDashboardService = require('../SERVICES/digital_coo/DepartmentDashboardService');

(async () => {
  const service = new DepartmentDashboardService({ rootDir: ROOT });
  const snapshot = await service.snapshot();
  assert.strictEqual(snapshot.ok, true);
  assert.ok(Array.isArray(snapshot.departments));
  assert.ok(snapshot.departments.length >= 14);
  const names = new Set(snapshot.departments.map(x => x.name));
  for (const required of ['Executive / CEO','Revenue / Sales','Marketing / Outbound','ORION / Government Intelligence','SLED','Engineering / MILES','Worker Runtime','Connector Runtime']) {
    assert.ok(names.has(required), `missing department ${required}`);
  }
  for (const d of snapshot.departments) {
    assert.ok(Array.isArray(d.current));
    assert.ok(Array.isArray(d.queued));
    assert.ok(Array.isArray(d.blockers));
    assert.ok(Array.isArray(d.awaitingApproval));
    assert.ok(Array.isArray(d.recentCompleted));
  }

  const commandCenter = fs.readFileSync(path.join(ROOT,'SERVICES','digital_coo','MilesCommandCenter.js'),'utf8');
  const index = fs.readFileSync(path.join(ROOT,'SERVICES','digital_coo','public','index.html'),'utf8');
  const app = fs.readFileSync(path.join(ROOT,'SERVICES','digital_coo','public','app.js'),'utf8');
  assert.ok(commandCenter.includes("'/api/dashboard'"), 'dashboard API route not installed');
  assert.ok(index.includes('id="departmentBoard"'), 'department board not installed');
  assert.ok(index.includes('id="refreshAllButton"'), 'global refresh button not installed');
  assert.ok(app.includes('refreshDashboard'), 'dashboard refresh logic not installed');

  console.log('PASS Test_Miles8787DepartmentDashboardP0');
  console.log(`departments=${snapshot.departments.length} operations=${snapshot.operationCount} status=${snapshot.status}`);
})().catch(error => { console.error(error); process.exit(1); });
