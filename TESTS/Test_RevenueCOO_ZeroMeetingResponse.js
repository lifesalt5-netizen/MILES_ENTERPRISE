"use strict";

const assert = require("assert");

const RevenueCOOService = require("../SERVICES/RevenueCOOService");

const zeroMeetingInventory = {
  read() {
    return {
      ok: true,
      status: "Healthy",
      p2gcEvents: 15,
      activeMeetings: 10,
      upcomingMeetings: 0,
      pastActiveMeetings: 10,
      canceledMeetings: 5
    };
  }
};

const service = new RevenueCOOService({
  meetingInventory: zeroMeetingInventory
});

const result = service.analyze(
  {
    business: {
      campaigns: [],
      replies: [],
      deals: [],
      mailboxes: [],
      segments: []
    }
  },
  "TEST-CYCLE"
);

assert.strictEqual(result.ok, true);
assert.strictEqual(result.metrics.meetingsUpcoming, 0);
assert.strictEqual(result.metrics.p2gcMeetingEvents, 15);

const mission = result.missions.find(
  item => item.title === "Restore qualified P2GC meeting inventory"
);

assert.ok(mission, "Expected zero-upcoming-meeting mission.");
assert.strictEqual(mission.priority, 1);
assert.strictEqual(mission.requiresKevin, false);
assert.strictEqual(mission.metadata.trigger, "ZERO_UPCOMING_P2GC_MEETINGS");
assert.strictEqual(mission.metadata.targetSegmentOrder[0], "CURRENTLY_LOOKING_FOR_HELP");
assert.strictEqual(
  mission.metadata.instantlyMutationPolicy,
  "EXISTING_CONTROLLED_WRITE_GOVERNANCE_ONLY"
);
assert.match(mission.recommendedAction, /CURRENTLY_LOOKING_FOR_HELP/);
assert.match(mission.recommendedAction, /do not enable Instantly mutations/i);

console.log("Revenue COO zero-meeting response: GREEN");
