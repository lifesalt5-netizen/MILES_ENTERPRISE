'use strict';

const assert = require('assert');
const { attachMeetingPipelineToBrief } = require('../SERVICES/CalendlyExecutiveBriefAdapter');

assert.strictEqual(typeof attachMeetingPipelineToBrief, 'function');

const brief = {
  todayPriorities: [
    { priority: 2, area: 'Marketing', action: 'Existing priority' }
  ]
};

const pipeline = {
  ok: true,
  status: 'Healthy',
  generatedAt: '2026-08-19T23:59:00.000Z',
  account: 'kevin@pathways2gc.com',
  metrics: {
    p2gcEvents: 15,
    activeMeetings: 10,
    upcomingMeetings: 0,
    pastActiveMeetings: 10,
    canceledMeetings: 5
  },
  upcomingMeetings: [],
  recentMeetings: [
    { inviteeName: 'Example Prospect', startTime: '2026-08-10T12:00:00.000Z' }
  ]
};

const result = attachMeetingPipelineToBrief(brief, pipeline);

assert.strictEqual(result.meetingPipeline.status, 'Healthy');
assert.strictEqual(result.meetingPipeline.source, 'CALENDLY');
assert.strictEqual(result.meetingPipeline.metrics.p2gcEvents, 15);
assert.strictEqual(result.meetingPipeline.metrics.upcomingMeetings, 0);
assert.strictEqual(result.meetingPipeline.metrics.pastActiveMeetings, 10);
assert.strictEqual(result.meetingPipeline.metrics.canceledMeetings, 5);
assert.strictEqual(result.meetingPipeline.recentMeetings.length, 1);
assert.match(result.todayPriorities[0].action, /0 upcoming meetings/i);
assert.strictEqual(result.todayPriorities[0].requiresKevin, false);

const upcomingResult = attachMeetingPipelineToBrief({ todayPriorities: [] }, {
  ...pipeline,
  metrics: { ...pipeline.metrics, upcomingMeetings: 2 },
  upcomingMeetings: [{ inviteeName: 'A' }, { inviteeName: 'B' }]
});

assert.match(upcomingResult.todayPriorities[0].action, /2 upcoming P2GC prospect meeting/i);
assert.strictEqual(upcomingResult.todayPriorities[0].requiresKevin, true);

const failedResult = attachMeetingPipelineToBrief({ todayPriorities: [] }, {
  ok: false,
  status: 'CALENDLY_REVENUE_PIPELINE_FAILED',
  error: 'example failure'
});

assert.strictEqual(failedResult.meetingPipeline.status, 'Critical');
assert.match(failedResult.todayPriorities[0].action, /Repair Calendly/i);

console.log('Calendly COO brief wiring test passed.');
