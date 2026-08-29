'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'SERVICES', 'ceo_dashboard', 'public', 'ceo.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'SERVICES', 'ceo_dashboard', 'public', 'index.html'), 'utf8');

assert(js.includes('getJson("/api/dashboard")'), 'Live CEO dashboard must read canonical command-center dashboard data');
assert(js.includes('canonicalPendingFromDashboard'), 'Live CEO dashboard must derive pending approvals canonically');
assert(js.includes('card("Kevin Approval", pending.length'), 'Kevin Approval metric must use canonical pending count');
assert(!js.includes('card("Kevin Approval", queue.awaitingApproval'), 'Legacy workQueue awaitingApproval must not drive Kevin metric');
assert(js.includes('data-approval-action="approve"'), 'Approve control must render');
assert(js.includes('data-approval-action="request-changes"'), 'Request Changes control must render');
assert(js.includes('data-approval-action="reject"'), 'Reject control must render');
assert(js.includes('View Details'), 'View Details must render');
assert(js.includes('Worker runtime approval backlog'), 'Worker-runtime backlog must be separately labeled');
assert(html.includes('id="approvalPanel"'), 'Approval panel must have a scroll target');
assert(html.includes('id="commandTechnical"'), 'Command technical details must be behind a disclosure');

console.log('live_ceo_canonical_approval_surface.test.js: PASS');
