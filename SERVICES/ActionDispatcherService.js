"use strict";

/**
 * MILES Action Dispatcher Service
 * EXEC_001
 * Complete replacement file.
 *
 * Purpose:
 * Executes only safe/internal providers in EXEC_001.
 * External providers are normalized and held until their controller exists.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "action_engine");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

class ActionDispatcherService {
    dispatch(actionRecord, provider) {
        const startedAt = Date.now();

        if (!provider) {
            return this.result(false, actionRecord, startedAt, "UNKNOWN_PROVIDER", "No provider found.");
        }

        if (provider.canExecute !== true) {
            return {
                ok: true,
                action: "ACTION_DISPATCH",
                status: "NEEDS_PROVIDER_CONNECTOR",
                provider: provider.id,
                operation: actionRecord.operation,
                executed: false,
                durationMs: Date.now() - startedAt,
                message: `Provider ${provider.name} is registered but not executable yet.`
            };
        }

        if (provider.id === "filesystem") {
            return this.dispatchFilesystem(actionRecord, startedAt);
        }

        if (provider.id === "orion") {
            return this.dispatchInternalRecord(actionRecord, startedAt, "ORION action recorded for connector execution.");
        }

        if (provider.id === "general_operations") {
            return this.dispatchInternalRecord(actionRecord, startedAt, "General operation recorded for MILES execution.");
        }

        return this.result(false, actionRecord, startedAt, "UNSUPPORTED_PROVIDER", `No dispatcher implemented for ${provider.id}.`);
    }

    dispatchFilesystem(actionRecord, startedAt) {
        const operation = String(actionRecord.operation || "CREATE_REPORT").toUpperCase();

        if (operation === "WRITE_JSON") {
            const target = actionRecord.payload?.targetPath
                ? path.resolve(actionRecord.payload.targetPath)
                : path.join(OUT_DIR, "filesystem_action_output.json");
            writeJson(target, actionRecord.payload?.value || { ok: true, actionId: actionRecord.id });
            return {
                ok: true,
                action: "ACTION_DISPATCH",
                status: "EXECUTED",
                provider: "filesystem",
                operation,
                executed: true,
                output: target,
                durationMs: Date.now() - startedAt,
                message: "JSON file written."
            };
        }

        return this.dispatchInternalRecord(actionRecord, startedAt, "Filesystem action recorded.");
    }

    dispatchInternalRecord(actionRecord, startedAt, message) {
        const actionDir = path.join(OUT_DIR, "actions");
        const file = path.join(actionDir, `${actionRecord.id}.json`);
        writeJson(file, {
            ok: true,
            generatedAt: new Date().toISOString(),
            actionRecord,
            message
        });
        return {
            ok: true,
            action: "ACTION_DISPATCH",
            status: "EXECUTED",
            provider: actionRecord.provider,
            operation: actionRecord.operation,
            executed: true,
            output: file,
            durationMs: Date.now() - startedAt,
            message
        };
    }

    result(ok, actionRecord, startedAt, status, message) {
        return {
            ok,
            action: "ACTION_DISPATCH",
            status,
            provider: actionRecord?.provider || null,
            operation: actionRecord?.operation || null,
            executed: ok,
            durationMs: Date.now() - startedAt,
            message
        };
    }
}

module.exports = new ActionDispatcherService();
