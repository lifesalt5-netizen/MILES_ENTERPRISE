"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "controlled_write");
const AUDIT_FILE = path.join(OUT_DIR, "controlled_write_audit.json");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ControlledWriteAuditService {
  record(event) {
    const audit = readJson(AUDIT_FILE, []);
    const record = { recordedAt: new Date().toISOString(), ...event };
    audit.push(record);
    writeJson(AUDIT_FILE, audit.slice(-1000));
    return record;
  }
  list() { return readJson(AUDIT_FILE, []); }
  run() {
    return { ok: true, action: "CONTROLLED_WRITE_AUDIT", generatedAt: new Date().toISOString(), records: this.list().slice(-50), outDir: OUT_DIR };
  }
}
module.exports = new ControlledWriteAuditService();
