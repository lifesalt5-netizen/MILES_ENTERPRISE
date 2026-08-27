'use strict';

const assert = require('assert');
const CalendlyRevenuePipelineService = require('../SERVICES/CalendlyRevenuePipelineService');
const { isP2GCEvent } = CalendlyRevenuePipelineService;

assert.strictEqual(typeof isP2GCEvent, 'function');
assert.strictEqual(isP2GCEvent({ name: 'Federal Strategy Session' }), true);
assert.strictEqual(isP2GCEvent({ name: '30 Minute Meeting', event_type: 'https://api.calendly.com/event_types/P2GC-Federal-Strategy' }), true);
assert.strictEqual(isP2GCEvent({ name: '30 Minute Meeting', location: { location: 'Pathways 2 Government Contracting' } }), true);
assert.strictEqual(isP2GCEvent({ name: 'Unrelated Personal Meeting', event_type: 'https://api.calendly.com/event_types/general', location: { location: 'Zoom' } }), false);

console.log('CALENDLY_REVENUE_EVENT_MATCHER=PASS');
