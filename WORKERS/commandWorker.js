"use strict";

const commandQueue = require("../CORE/CommandQueue");

console.log("[COMMAND] Command worker online");

function runCommandWorker() {
  try {
    const item = commandQueue.claim("COMMAND_WORKER");

    if (!item) return;

    console.log("[COMMAND] Claimed:", item.title);

    commandQueue.complete(item.id, {
      message: "Command received and logged.",
      next: "Dispatcher/Builder pipeline pending."
    });

    console.log("[COMMAND] Completed:", item.title);

  } catch (err) {
    console.error("[COMMAND] Worker failed:", err.message);
  }
}

setInterval(runCommandWorker, 10000);
runCommandWorker();