"use strict";

/**
 * MILES Restart Guardian Service
 * BUILD_036
 * Complete replacement file.
 *
 * Purpose:
 * Captures loop failures and writes restart recommendations.
 * The PowerShell runner performs the actual process restart.
 */

const path = require("path");
const json = require("./JsonFileService");
const time = require("./TimeUtil");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime");
const GUARDIAN_FILE = path.join(RUNTIME_DIR, "restart_guardian.json");
const GUARDIAN_HISTORY = path.join(RUNTIME_DIR, "restart_guardian_history.json");

class RestartGuardianService {
    run(input = {}) {
        const errors = Array.isArray(input.errors) ? input.errors : [];
        const consecutiveFailures = Number(input.consecutiveFailures || 0);
        const restartRecommended = consecutiveFailures >= Number(input.maxFailuresBeforeRestart || 3);

        const record = {
            ok: true,
            action: "RESTART_GUARDIAN",
            generatedAt: time.nowIso(),
            cycleId: input.cycleId || null,
            consecutiveFailures,
            restartRecommended,
            errors: errors.slice(-10),
            recommendation: restartRecommended
                ? "Restart COO loop process using RUN_COO_LOOP_FOREVER.ps1."
                : "Continue COO loop."
        };

        json.writeJson(GUARDIAN_FILE, record);
        json.appendJsonArray(GUARDIAN_HISTORY, record, 1000);
        return record;
    }
}

module.exports = new RestartGuardianService();
