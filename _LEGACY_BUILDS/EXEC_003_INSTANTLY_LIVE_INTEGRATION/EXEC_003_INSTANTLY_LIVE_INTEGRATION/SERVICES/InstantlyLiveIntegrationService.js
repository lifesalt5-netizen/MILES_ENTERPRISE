"use strict";

/** EXEC_003 Instantly Live Integration Service - Complete replacement file. */

const fs = require("fs");
const path = require("path");
const instantly = require("./InstantlyLiveProviderController");
const bridge = require("./InstantlyActionBridgeService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "instantly_live");
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class InstantlyLiveIntegrationService {
    async run(input = {}) {
        const startedAt = Date.now();
        const mode = String(input.mode || input.operation || "HEALTH_CHECK").toUpperCase();
        let result;
        if (mode === "BRIDGE_LATEST_ACTION") {
            result = await bridge.runLatestActionEngineInstantlyAction();
        } else {
            result = await instantly.execute({ operation: mode, payload: input.payload || {} });
        }
        const state = {
            ok: Boolean(result.ok),
            action: "INSTANTLY_LIVE_INTEGRATION",
            type: "MILES_INSTANTLY_LIVE_STATE",
            build: "EXEC_003",
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            status: instantly.status(),
            result,
            summary: {
                credentialsPresent: instantly.status().credentialsPresent,
                writeEnabled: instantly.status().writeEnabled,
                executable: instantly.status().executable,
                resultStatus: result.status || result.summary?.status || null
            },
            outDir: OUT_DIR
        };
        writeJson(path.join(OUT_DIR, "instantly_live_state.json"), state);
        writeJson(path.join(OUT_DIR, "latest_instantly_live_run.json"), state);
        fs.writeFileSync(path.join(OUT_DIR, "instantly_live_report.md"), this.renderReport(state), "utf8");
        return state;
    }

    renderReport(state) {
        return `# EXEC_003 Instantly Live Integration Report\n\nGenerated: ${state.generatedAt}\n\nCredentials Present: ${state.summary.credentialsPresent}\nWrite Enabled: ${state.summary.writeEnabled}\nExecutable: ${state.summary.executable}\nResult Status: ${state.summary.resultStatus}\n\n## Notes\n\n- Read operations are enabled when INSTANTLY_API_KEY is configured.\n- Write operations require INSTANTLY_WRITE_ENABLED=true.\n- All live operations write audit records to DATA/instantly_live.\n`;
    }
}

module.exports = new InstantlyLiveIntegrationService();
