'use strict';

const assert = require('assert');
const gateway = require('../SERVICES/digital_coo/UnifiedMilesGateway');

assert.equal(gateway.PUBLIC_PORT, Number(process.env.MILES_UNIFIED_PORT || 8787));
assert.equal(gateway.COMMAND_PORT, Number(process.env.MILES_INTERNAL_COMMAND_PORT || 8788));
assert.equal(gateway.DASHBOARD_PORT, Number(process.env.MILES_DASHBOARD_PORT || 8737));
assert.equal(gateway.PRODUCT_PORT, Number(process.env.P2GC_GROWTH_DEMO_PORT || 8791));

assert(gateway.matchesPrefix('/api/command', gateway.COMMAND_API_PREFIXES));
assert(gateway.matchesPrefix('/api/operations/op_1/approve', gateway.COMMAND_API_PREFIXES));
assert(gateway.matchesPrefix('/api/state', gateway.DASHBOARD_API_PREFIXES));
assert(gateway.matchesPrefix('/api/brief?x=1'.split('?')[0], gateway.DASHBOARD_API_PREFIXES));
assert(gateway.matchesPrefix('/api/assessment', gateway.PRODUCT_API_PREFIXES));
assert(gateway.matchesPrefix('/api/proposal-command/run', gateway.PRODUCT_API_PREFIXES));

for (const route of ['/demo','/teaming','/opportunities','/vehicles','/recompetes','/proposal-command']) {
  assert(gateway.PRODUCT_PAGE_PATHS.has(route), `${route} must stay on the unified 8787 surface`);
}

const dashboard = gateway.rewriteDashboardHtml(`
<a href="http://127.0.0.1:8791/demo">demo</a>
<a href="http://127.0.0.1:8791/teaming">teaming</a>
<a href="http://127.0.0.1:8791/opportunities">opportunities</a>
<a href="http://127.0.0.1:8791/vehicles">vehicles</a>
<a href="http://127.0.0.1:8791/recompetes">recompetes</a>
<a href="http://127.0.0.1:8791/proposal-command">proposal</a>
<a href="http://127.0.0.1:8787">execution</a>
`);

assert(dashboard.includes('href="/demo"'));
assert(dashboard.includes('href="/teaming"'));
assert(dashboard.includes('href="/opportunities"'));
assert(dashboard.includes('href="/vehicles"'));
assert(dashboard.includes('href="/recompetes"'));
assert(dashboard.includes('href="/proposal-command"'));
assert(dashboard.includes('href="/execution"'));
assert(!dashboard.includes('127.0.0.1:8791'));

const execution = gateway.rewriteExecutionHtml('<link rel="stylesheet" href="/styles.css"><script src="/app.js"></script>');
assert(execution.includes('/execution/styles.css'));
assert(execution.includes('/execution/app.js'));

console.log('UNIFIED_MILES_GATEWAY_REGRESSIONS=GREEN');
