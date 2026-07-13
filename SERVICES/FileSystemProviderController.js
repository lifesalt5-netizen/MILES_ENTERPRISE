"use strict";
const fs = require("fs");
const path = require("path");
const BaseProviderController = require("./BaseProviderController");
const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
class FileSystemProviderController extends BaseProviderController {
    constructor() {
        super({ key: "filesystem", name: "File System", executable: true, envKeys: [], supportedOperations: ["HEALTH_CHECK", "ENSURE_DIRECTORY", "WRITE_JSON", "READ_JSON", "VERIFY_PATH"] });
    }
    safePath(p) {
        const full = path.resolve(ROOT, p || "DATA\\provider_controllers");
        if (!full.toLowerCase().startsWith(path.resolve(ROOT).toLowerCase())) throw new Error("Unsafe path outside MILES_ROOT.");
        return full;
    }
    async execute(actionRecord) {
        const op = actionRecord.operation;
        const payload = actionRecord.payload || {};
        try {
            if (op === "HEALTH_CHECK") return { ok: true, provider: this.key, operation: op, status: "EXECUTED", executed: true, generatedAt: this.now() };
            if (op === "ENSURE_DIRECTORY") { const dir = this.safePath(payload.path); fs.mkdirSync(dir, { recursive: true }); return { ok: true, provider: this.key, operation: op, status: "EXECUTED", executed: true, path: dir, generatedAt: this.now() }; }
            if (op === "WRITE_JSON") { const file = this.safePath(payload.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(payload.value || {}, null, 2), "utf8"); return { ok: true, provider: this.key, operation: op, status: "EXECUTED", executed: true, path: file, generatedAt: this.now() }; }
            if (op === "READ_JSON") { const file = this.safePath(payload.path); const value = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; return { ok: true, provider: this.key, operation: op, status: "EXECUTED", executed: true, path: file, value, generatedAt: this.now() }; }
            if (op === "VERIFY_PATH") { const file = this.safePath(payload.path); return { ok: true, provider: this.key, operation: op, status: "EXECUTED", executed: true, exists: fs.existsSync(file), path: file, generatedAt: this.now() }; }
            return super.execute(actionRecord);
        } catch (error) { return { ok: false, provider: this.key, operation: op, status: "FAILED", executed: false, error: error.message, generatedAt: this.now() }; }
    }
}
module.exports = new FileSystemProviderController();
