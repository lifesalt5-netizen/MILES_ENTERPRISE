"use strict";

/**
 * MILES Loop Scheduler Service
 * BUILD_036
 * Complete replacement file.
 */

const time = require("./TimeUtil");

class LoopSchedulerService {
    getIntervalMs(input = {}) {
        const fromInput = Number(input.intervalMs || input.sleepMs || 0);
        if (fromInput > 0) return fromInput;

        const fromEnv = Number(process.env.MILES_COO_LOOP_INTERVAL_MS || 0);
        if (fromEnv > 0) return fromEnv;

        return 60000;
    }

    getMaxCycles(input = {}) {
        if (input.infinite === true) return null;
        if (String(input.mode || "").toUpperCase() === "ONCE") return 1;

        const fromInput = Number(input.maxCycles || 0);
        if (fromInput > 0) return fromInput;

        const fromEnv = Number(process.env.MILES_COO_LOOP_MAX_CYCLES || 0);
        if (fromEnv > 0) return fromEnv;

        return null;
    }

    async sleep(input = {}) {
        const intervalMs = this.getIntervalMs(input);
        await time.sleep(intervalMs);
        return {
            ok: true,
            action: "LOOP_SLEEP",
            intervalMs
        };
    }
}

module.exports = new LoopSchedulerService();
