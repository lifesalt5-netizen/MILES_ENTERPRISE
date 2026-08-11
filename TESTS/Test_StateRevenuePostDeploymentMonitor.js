'use strict';

const assert = require('assert');
const service = require('../SERVICES/StateRevenuePostDeploymentMonitor');

assert.deepStrictEqual(service.unwrapItems([{id:1}]), [{id:1}]);
assert.deepStrictEqual(service.unwrapItems({items:[{id:2}]}), [{id:2}]);
assert.strictEqual(service.numberFrom({sent:'25'}, ['sent']), 25);
assert.strictEqual(service.numberFrom({}, ['sent']), 0);

console.log('STATE_REVENUE_POST_DEPLOYMENT_MONITOR_TEST=PASS');
