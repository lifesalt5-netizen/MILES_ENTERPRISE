"use strict";

require("dotenv").config();
console.log("[DEBUG] Running delegated StartProductionSystem from:", __filename);

/*
  BUILD 036 — SINGLE EXECUTION AUTHORITY

  This legacy service entry point may still be referenced by older scripts,
  but it no longer consumes CORE/TaskQueue tasks.

  The authoritative worker runtime is:

      <MILES_ROOT>\StartProductionSystem.js

  That root runtime owns:
  - atomic task claims
  - stale RUNNING recovery
  - retries
  - provider execution
  - work queue reconciliation
  - execution metrics
*/

require("./api/server");

require("./workers/cooWorker");
require("./workers/revenueWorker");
require("./workers/replyWorker");
require("./workers/dealWorker");
require("./workers/atlasWorker");

const supervisor = require("./CORE/Supervisor");
const { bus } = require("./event-bus/emitter");

console.log("");
console.log("[MILES] ===============================");
console.log("[MILES] DELEGATED SERVICE RUNTIME ONLINE");
console.log("[MILES] EXECUTION OWNER: MILES_RESIDENT_WORKER");
console.log("[MILES] ===============================");
console.log("");

function startHeartbeat() {
    setInterval(() => {
        console.log(
            "[MILES] DELEGATED HEARTBEAT → COO_TICK | execution delegated"
        );

        bus.emit("COO_TICK");
    }, 15000);
}

async function boot() {
    console.log("[MILES] Booting delegated workers...");

    await supervisor.start();

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log("[MILES] Delegated workers online");
    console.log(
        "[MILES] Task execution remains exclusively owned by root StartProductionSystem.js"
    );
    console.log("");

    startHeartbeat();
}

boot().catch(err => {
    console.error("");
    console.error("[MILES] DELEGATED BOOT FAILED");
    console.error(err);

    process.exit(1);
});
