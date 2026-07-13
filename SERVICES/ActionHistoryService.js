"use strict";

/**
 * MILES Action History Service
 * EXEC_001
 * Complete replacement file.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "action_engine");
const HISTORY_FILE = path.join(OUT_DIR, "action_history.json");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { return fallback; }
}
function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

class ActionHistoryService {
    append(record) {
        const history = readJson(HISTORY_FILE, []);
        const entry = {
            recordedAt: new Date().toISOString(),
            ...record
        };
        history.push(entry);
        writeJson(HISTORY_FILE, history.slice(-1000));
        return entry;
    }

    getRecent(limit = 100) {
        return readJson(HISTORY_FILE, []).slice(-limit);
    }

    summarize() {
        const history = this.getRecent(1000);
        const byStatus = {};
        const byProvider = {};
        for (const item of history) {
            const status = item.status || item.result?.status || "UNKNOWN";
            const provider = item.provider || item.actionRecord?.provider || "UNKNOWN";
            byStatus[status] = (byStatus[status] || 0) + 1;
            byProvider[provider] = (byProvider[provider] || 0) + 1;
        }
        return { total: history.length, byStatus, byProvider, latest: history.slice(-10) };
    }

    run() {
        return {
            ok: true,
            action: "ACTION_HISTORY",
            generatedAt: new Date().toISOString(),
            summary: this.summarize(),
            outDir: OUT_DIR
        };
    }
}

module.exports = new ActionHistoryService();
