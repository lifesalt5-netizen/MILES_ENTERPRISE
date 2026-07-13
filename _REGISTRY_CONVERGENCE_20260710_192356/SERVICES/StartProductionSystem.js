"use strict";

require("dotenv").config();
console.log("[DEBUG] Running StartProductionSystem from:", __filename);

// =========================
// CORE SYSTEMS
// =========================

require("./api/server");

const executionService = require("./SERVICES/ExecutionService");

require("./workers/cooWorker");
require("./workers/revenueWorker");
require("./workers/replyWorker");
require("./workers/dealWorker");
require("./workers/atlasWorker");

// =========================
// SUPERVISOR
// =========================

const supervisor = require("./CORE/Supervisor");

// =========================
// EVENT BUS
// =========================

const { bus } = require("./event-bus/emitter");

console.log("");
console.log("[MILES] ===============================");
console.log("[MILES] AUTONOMOUS SYSTEM ONLINE");
console.log("[MILES] EVENT LOOP ACTIVE");
console.log("[MILES] ===============================");
console.log("");

// =========================
// EXECUTION LOOP
// =========================

let executionLoopRunning = false;

function startExecutionLoop() {
    console.log("[MILES] Execution loop starting.");

    setInterval(async () => {
        if (executionLoopRunning) {
            return;
        }

        executionLoopRunning = true;

        try {
            await executionService.runNext();
        } catch (err) {
            console.error("[MILES] EXECUTION LOOP ERROR");
            console.error(err);
        } finally {
            executionLoopRunning = false;
        }
    }, 1000);
}

// =========================
// HEARTBEAT LOOP
// =========================

function startHeartbeat() {
    setInterval(() => {
        console.log("[MILES] HEARTBEAT → COO_TICK");
        bus.emit("COO_TICK");
    }, 15000);
}

// =========================
// BOOT
// =========================

async function boot() {
    console.log("[MILES] Booting workers...");

    await supervisor.start();

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log("[MILES] Workers online");
    console.log("[MILES] System fully running");
    console.log("");

    startExecutionLoop();
    startHeartbeat();
}

boot().catch(err => {
    console.error("");
    console.error("[MILES] BOOT FAILED");
    console.error(err);

    process.exit(1);
});