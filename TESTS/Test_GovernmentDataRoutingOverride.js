'use strict';

const assert = require('assert');
const planner = require('../SERVICES/CommandIntentPlannerGovernmentDataOverride');

const gsa = planner.plan({ command: 'Miles, refresh and reconcile the current GSA vendor universe. Do not send anything to Instantly. Execute now.' });
assert.strictEqual(gsa.intent, 'EXECUTIVE_MISSION');
assert.strictEqual(gsa.workflow, 'EXECUTIVE_MISSION_PLANNING');
assert.strictEqual(gsa.action, 'BUSINESS_EXECUTION');
assert.strictEqual(gsa.provider, 'MILES');

const website = planner.plan({ command: 'Miles, review website health.' });
assert.strictEqual(website.workflow, 'WEBSITE_REVIEW');

const mixed = planner.plan({ command: 'Miles, review Instantly campaign health and mention the website field in the report.' });
assert.strictEqual(mixed.workflow, 'INSTANTLY_LIVE_REVIEW');

console.log('GOVERNMENT_DATA_ROUTING_OVERRIDE_TEST_PASS');
