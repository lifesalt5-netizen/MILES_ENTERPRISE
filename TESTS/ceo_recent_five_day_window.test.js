'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'SERVICES', 'ceo_dashboard', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'SERVICES', 'ceo_dashboard', 'public', 'ceo_recent_window.js'), 'utf8');

assert(html.includes('Recent Work <span class="muted">· Last 5 Days</span>'), 'Recent Work must visibly state the five-day window.');
assert(html.includes('Recent Activity <span class="muted">· Last 5 Days</span>'), 'Recent Activity must visibly state the five-day window.');
assert(html.includes('/ceo_recent_window.js'), 'CEO dashboard must load the recent-window enforcement script.');
assert(js.includes('const RECENT_WINDOW_DAYS = 5;'), 'Recent-window policy must be exactly five days.');
assert(js.includes('filter(withinFiveDays)'), 'Work/activity rendering must filter by the five-day cutoff.');
assert(js.includes('function dedupe('), 'Visible repeated events must be collapsed without deleting source history.');
assert(!js.includes('unlinkSync') && !js.includes('rmSync') && !js.includes('writeFileSync'), 'Recent-window UI must not delete or rewrite historical source data.');

console.log('CEO_RECENT_FIVE_DAY_WINDOW_ACCEPTANCE_PASS');
