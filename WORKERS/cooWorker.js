"use strict";

const bus = require("../CORE/EventBus");

let COOEngine;
let engineName;

try {
  COOEngine = require("../SERVICES/AutonomousCOOLoopService");
  engineName = "AutonomousCOOLoopService";
} catch (err) {
  console.error("[MILES] Autonomous COO unavailable:", err.message);
  COOEngine = require("../SERVICES/ProductionCOOEngine");
  engineName = "ProductionCOOEngine_FALLBACK";
}

const coo = new COOEngine({});

console.log("[MILES] COO Worker using:", engineName);

bus.on("COO_TICK", async () => {
  try {
    let result;

    if (typeof coo.runOnce === "function") {
      result = await coo.runOnce();
    } else if (typeof coo.runCycle === "function") {
      result = await coo.runCycle();
    } else {
      throw new Error("No COO run method found.");
    }

    console.log("[COO] Cycle completed via:", engineName);

    bus.emit("COO_RESULT", result);
  } catch (err) {
    console.error("[COO] Fatal COO error:", err.message);
    console.error(err.stack);
  }
});