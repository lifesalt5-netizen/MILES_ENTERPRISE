"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "business_execution");
const AUDIT_FILE = path.join(OUT_DIR, "execution_audit.json");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ExecutionAuditService {
    record(event = {}) {
        ensureDir(OUT_DIR);
        const history = readJson(AUDIT_FILE, []);
        const record = {
            id: event.id || `EXEC-AUDIT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            recordedAt: new Date().toISOString(),
            source: "ExecutionAuditService",
            ...event
        };
        history.push(record);
        writeJson(AUDIT_FILE, history.slice(-1000));
        return record;
    }

    recent(limit = 50) {
        return readJson(AUDIT_FILE, []).slice(-limit);
    }
}

module.exports = new ExecutionAuditService();
