'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'SERVICES', 'COOOrchestratorService.js'), 'utf8');

assert.ok(source.includes('RevenueCrmProgressionService'));
assert.ok(source.includes('this.revenueCrmProgression'));
assert.ok(source.includes('this.refreshRevenueCrmProgression('));
assert.ok(source.includes('calendlyRevenuePipelineResult'));
assert.ok(source.includes('revenueCrmProgressionResult'));

const calendlyIndex = source.indexOf('await this.refreshCalendlyRevenuePipeline()');
const crmIndex = source.indexOf('this.refreshRevenueCrmProgression(');
const refreshIndex = source.indexOf('await this.intelligence.refresh();', calendlyIndex);
assert.ok(calendlyIndex >= 0);
assert.ok(crmIndex > calendlyIndex, 'CRM progression must run after Calendly refresh');
assert.ok(refreshIndex > crmIndex, 'Executive intelligence refresh must occur after CRM progression');

console.log('COO_REVENUE_CRM_PROGRESSION_WIRING_TEST=PASS');
