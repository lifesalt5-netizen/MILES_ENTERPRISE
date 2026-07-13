"use strict";

const { bus } = require("../event-bus/emitter");
const AutonomousRevenueClosureLoop =
  require("../SERVICES/AutonomousRevenueClosureLoop");
  const path = require("path");

console.log(
  "[DEBUG] Revenue Loop Loaded From:",
  require.resolve("../SERVICES/AutonomousRevenueClosureLoop")
);


const revenue = new AutonomousRevenueClosureLoop();

bus.on("COO_RESULT", async (state) => {

  const result = await revenue.run(state);

  console.log("[REVENUE] Emitting REVENUE_RESULT");

  bus.emit("REVENUE_RESULT", result);
});