"use strict";

const assert = require("assert");
const svc = require("../SERVICES/StateSledFlLaunchReadinessService");

assert.strictEqual(svc.sequenceStepCount({ sequences: [{ steps: [{}, {}, {}, {}] }] }), 4);
assert.strictEqual(svc.sequenceStepCount({ sequences: [] }), 0);

const schedule = svc.getSchedule({ campaign_schedule: { schedules: [{ timezone: "America/Detroit" }] } });
assert.strictEqual(schedule.timezone, "America/Detroit");

const healthy = svc.selectHealthySenders([
  { email: "good@example.com", status: 1, warmup_status: 1, setup_pending: false, stat_warmup_score: 90 },
  { email: "cold@example.com", status: 1, warmup_status: 1, setup_pending: false, stat_warmup_score: 50 },
  { email: "off@example.com", status: 0, warmup_status: 1, setup_pending: false, stat_warmup_score: 95 }
], { senderPolicy: { minimumWarmupScore: 70 } });

assert.deepStrictEqual(healthy.map(x => x.email), ["good@example.com"]);
console.log("STATE_SLED_FL_LAUNCH_READINESS_TEST=PASS");
