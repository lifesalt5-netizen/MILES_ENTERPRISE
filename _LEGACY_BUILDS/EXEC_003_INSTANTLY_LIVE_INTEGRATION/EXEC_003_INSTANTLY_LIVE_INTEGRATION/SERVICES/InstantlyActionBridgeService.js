"use strict";

/**
 * EXEC_003 Instantly Action Bridge Service
 * Complete replacement file.
 *
 * Purpose:
 * Bridges Action Engine records to the Instantly live provider controller.
 */

const fs = require("fs");
const path = require("path");
const instantly = require("./InstantlyLiveProviderController");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "instantly_live");
const ACTION_ENGINE_DIR = path.join(ROOT, "DATA", "action_engine");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; } catch { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class InstantlyActionBridgeService {
    normalizeAction(input = {}) {
        const action = input.actionRecord || input.action || input;
        return {
            id: action.id || `INSTANTLY-ACTION-${Date.now()}`,
            provider: "instantly",
            operation: String(action.operation || input.operation || "HEALTH_CHECK").toUpperCase(),
            payload: action.payload || input.payload || {},
            source: input.source || "InstantlyActionBridgeService",
            generatedAt: new Date().toISOString()
        };
    }

    async run(input = {}) {
        const startedAt = Date.now();
        const action = this.normalizeAction(input);
        const connection = await instantly.connect();
        const execution = await instantly.execute(action);
        const verification = await instantly.verify(action, execution);
        const record = {
            ok: Boolean(execution.ok),
            action: "INSTANTLY_ACTION_BRIDGE",
            build: "EXEC_003",
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            normalizedAction: action,
            connection,
            execution,
            verification,
            summary: {
                provider: "instantly",
                operation: action.operation,
                connected: Boolean(connection.connected),
                executed: Boolean(execution.executed),
                verified: Boolean(verification.verified),
                status: verification.status || execution.status
            },
            outDir: OUT_DIR
        };
        writeJson(path.join(OUT_DIR, "latest_action_bridge.json"), record);
        return record;
    }

    async runLatestActionEngineInstantlyAction() {
        const candidates = [
            path.join(ACTION_ENGINE_DIR, "latest_action_engine_run.json"),
            path.join(ACTION_ENGINE_DIR, "latest_action.json"),
            path.join(ACTION_ENGINE_DIR, "action_history.json")
        ];
        let found = null;
        for (const file of candidates) {
            const data = readJson(file, null);
            if (!data) continue;
            const records = Array.isArray(data) ? data.slice().reverse() : (data.actions || data.results || [data]);
            found = records.find(r => String(r.provider || r.actionRecord?.provider || "").toLowerCase() === "instantly");
            if (found) break;
        }
        return await this.run(found || { provider: "instantly", operation: "HEALTH_CHECK", payload: {} });
    }
}

module.exports = new InstantlyActionBridgeService();
