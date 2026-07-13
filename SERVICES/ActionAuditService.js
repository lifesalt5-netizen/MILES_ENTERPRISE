"use strict";

/**
 * MILES Action Audit Service
 * EXEC_001
 * Complete replacement file.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "action_engine");
const AUDIT_FILE = path.join(OUT_DIR, "action_audit_log.json");

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

class ActionAuditService {
    append(record) {
        const entry = {
            auditId: `AUDIT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            generatedAt: new Date().toISOString(),
            actor: "MILES",
            ...record
        };
        const log = readJson(AUDIT_FILE, []);
        log.push(entry);
        writeJson(AUDIT_FILE, log.slice(-1000));
        return entry;
    }

    read(limit = 100) {
        return readJson(AUDIT_FILE, []).slice(-limit);
    }

    run() {
        const entries = this.read(1000);
        return {
            ok: true,
            action: "ACTION_AUDIT",
            generatedAt: new Date().toISOString(),
            entries: entries.length,
            latest: entries.slice(-10),
            outDir: OUT_DIR
        };
    }
}

module.exports = new ActionAuditService();
