'use strict';
const path = require('path');
const { readCsv } = require('../CORE/csv_utils');
function p(root, ...parts) { return path.join(root, ...parts); }
const root = process.argv[2] || process.cwd();
const summary = readCsv(p(root, 'reports', 'miles_automation_run_summary.csv'));
const approvals = readCsv(p(root, 'tasks', 'approval_queue.csv'));
console.log('MILES EXECUTIVE STATUS');
console.log('Automation results:', summary.length);
console.log('CEO approvals pending:', approvals.filter(a => String(a.status || '').includes('PENDING')).length);
for (const r of summary.slice(-10)) console.log(`${r.status} | ${r.capability}`);
