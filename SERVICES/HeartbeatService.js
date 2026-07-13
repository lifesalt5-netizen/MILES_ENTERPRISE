"use strict";

/**
 * MILES Heartbeat Service
 * BUILD_036
 * Complete replacement file.
 */

const path = require("path");
const os = require("os");
const json = require("./JsonFileService");
const time = require("./TimeUtil");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const HEARTBEAT_FILE = path.join(RUNTIME_DIR, "coo_loop_heartbeat.json");
const HEARTBEAT_HISTORY = path.join(RUNTIME_DIR, "coo_loop_heartbeat_history.json");

class HeartbeatService {
    run(input = {}) {
        const record = {
            ok: true,
            action: "HEARTBEAT",
            generatedAt: time.nowIso(),
            cycleId: input.cycleId || null,
            loopMode: input.loopMode || "UNKNOWN",
            pid: process.pid,
            hostname: os.hostname(),
            platform: process.platform,
            nodeVersion: process.version,
            uptimeSeconds: Math.round(process.uptime()),
            memory: process.memoryUsage()
        };

        json.writeJson(HEARTBEAT_FILE, record);
        json.appendJsonArray(HEARTBEAT_HISTORY, record, 1000);
        return record;
    }
}

module.exports = new HeartbeatService();
