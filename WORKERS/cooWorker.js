"use strict";

const bus = require("../CORE/EventBus");

// The dedicated miles-autonomous-coo PM2 process owns COO planning.
// The resident miles-worker owns TaskQueue execution only. Historically this
// worker subscribed to COO_TICK and launched a second AutonomousCOOLoopService,
// which caused duplicate planning cycles and competing writes to latest_* COO
// evidence files. Keep the event contract, but do not run a second planner here.

console.log("[MILES] COO Worker planning delegated to miles-autonomous-coo");

bus.on("COO_TICK", payload => {
  const result = {
    ok: true,
    status: "COO_PLANNING_DELEGATED",
    planner: "miles-autonomous-coo",
    executor: "miles-worker",
    observedAt: new Date().toISOString(),
    heartbeat: payload || null
  };

  console.log("[COO] Tick observed; planning delegated to miles-autonomous-coo");
  bus.emit("COO_RESULT", result);
});
