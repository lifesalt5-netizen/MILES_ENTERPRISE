"use strict";

/**
 * MILES Runtime Health Service
 * BUILD_036
 * Complete replacement file.
 */

const path = require("path");
const json = require("./JsonFileService");
const time = require("./TimeUtil");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const HEALTH_FILE = path.join(RUNTIME_DIR, "coo_runtime_health.json");
const HEALTH_HISTORY = path.join(RUNTIME_DIR, "coo_runtime_health_history.json");

class RuntimeHealthService {
    run(input = {}) {
        const generatedAt = time.nowIso();
        const checks = this.buildChecks(input);
        const failed = checks.filter(c => !c.ok);
        const warnings = checks.filter(c => c.severity === "WARNING" && c.ok === false);

        const status = failed.some(c => c.severity === "CRITICAL")
            ? "CRITICAL"
            : failed.length
                ? "WATCH"
                : "HEALTHY";

        const record = {
            ok: status !== "CRITICAL",
            action: "RUNTIME_HEALTH",
            generatedAt,
            status,
            checks,
            summary: {
                totalChecks: checks.length,
                failed: failed.length,
                warnings: warnings.length
            }
        };

        json.writeJson(HEALTH_FILE, record);
        json.appendJsonArray(HEALTH_HISTORY, record, 1000);
        return record;
    }

    buildChecks(input = {}) {
        const results = Array.isArray(input.results) ? input.results : [];
        const checks = [];

        for (const result of results) {
            checks.push({
                ok: result && result.ok !== false,
                name: result?.action || result?.name || "UNKNOWN_STEP",
                severity: result && result.ok === false ? "WARNING" : "INFO",
                message: result && result.ok === false
                    ? (result.error || "Step reported not ok.")
                    : "Step completed."
            });
        }

        checks.push({
            ok: true,
            name: "PROCESS_ALIVE",
            severity: "INFO",
            message: `Node process ${process.pid} is alive.`
        });

        return checks;
    }
}

module.exports = new RuntimeHealthService();
