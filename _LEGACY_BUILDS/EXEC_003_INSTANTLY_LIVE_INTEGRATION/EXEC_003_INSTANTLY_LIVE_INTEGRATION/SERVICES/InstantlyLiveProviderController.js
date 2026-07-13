"use strict";

/**
 * EXEC_003 Instantly Live Provider Controller
 * Complete replacement file.
 *
 * Purpose:
 * Gives Miles a real Instantly execution surface behind the Action Engine.
 * Safe by default: write operations require INSTANTLY_WRITE_ENABLED=true.
 */

const fs = require("fs");
const path = require("path");
const InstantlyApiClient = require("./InstantlyApiClient");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "instantly_live");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }
function appendJson(file, record, max = 1000) {
    let arr = [];
    try { if (fs.existsSync(file)) arr = JSON.parse(fs.readFileSync(file, "utf8")); } catch { arr = []; }
    arr.push(record);
    writeJson(file, arr.slice(-max));
}

class InstantlyLiveProviderController {
    constructor(options = {}) {
        this.provider = "instantly";
        this.providerName = "Instantly";
        this.client = options.client || new InstantlyApiClient(options);
        this.writeEnabled = String(options.writeEnabled ?? process.env.INSTANTLY_WRITE_ENABLED ?? "false").toLowerCase() === "true";
        this.supportedOperations = [
            "HEALTH_CHECK",
            "LIST_CAMPAIGNS",
            "GET_CAMPAIGN",
            "CREATE_CAMPAIGN",
            "PAUSE_CAMPAIGN",
            "RESUME_CAMPAIGN",
            "UPLOAD_LEADS",
            "ASSIGN_SENDING_ACCOUNTS",
            "GENERATE_CAMPAIGN_REPORT"
        ];
    }

    status() {
        return {
            ok: true,
            provider: this.provider,
            providerName: this.providerName,
            executable: this.client.credentialsPresent(),
            credentialsPresent: this.client.credentialsPresent(),
            writeEnabled: this.writeEnabled,
            safeMode: !this.writeEnabled,
            supportedOperations: this.supportedOperations,
            generatedAt: new Date().toISOString()
        };
    }

    async connect() {
        const base = this.status();
        if (!base.credentialsPresent) {
            return { ...base, connected: false, status: "MISSING_CREDENTIALS", message: "INSTANTLY_API_KEY is not configured." };
        }
        const health = await this.healthCheck();
        return { ...base, connected: health.ok, status: health.ok ? "CONNECTED" : "CONNECT_FAILED", health };
    }

    async healthCheck() {
        const startedAt = Date.now();
        const result = await this.client.get("/campaigns?limit=1");
        const record = {
            ok: result.ok,
            action: "INSTANTLY_HEALTH_CHECK",
            provider: this.provider,
            status: result.ok ? "READY" : result.status,
            credentialsPresent: this.client.credentialsPresent(),
            writeEnabled: this.writeEnabled,
            durationMs: Date.now() - startedAt,
            result,
            generatedAt: new Date().toISOString()
        };
        this.save("latest_health.json", record);
        return record;
    }

    async execute(action = {}) {
        const operation = String(action.operation || action.action || "HEALTH_CHECK").toUpperCase();
        const payload = action.payload || {};
        const startedAt = Date.now();

        let result;
        if (!this.supportedOperations.includes(operation)) {
            result = { ok: false, status: "UNSUPPORTED_OPERATION", message: `Unsupported Instantly operation: ${operation}` };
        } else if (["CREATE_CAMPAIGN", "PAUSE_CAMPAIGN", "RESUME_CAMPAIGN", "UPLOAD_LEADS", "ASSIGN_SENDING_ACCOUNTS"].includes(operation) && !this.writeEnabled) {
            result = { ok: true, executed: false, status: "SAFE_MODE_WRITE_DISABLED", message: "Set INSTANTLY_WRITE_ENABLED=true to allow live write operations.", payloadPreview: payload };
        } else {
            result = await this.runOperation(operation, payload);
        }

        const record = {
            ok: Boolean(result.ok),
            action: "INSTANTLY_PROVIDER_EXECUTION",
            provider: this.provider,
            operation,
            status: result.status || (result.ok ? "EXECUTED" : "FAILED"),
            executed: Boolean(result.executed ?? result.ok),
            durationMs: Date.now() - startedAt,
            result,
            generatedAt: new Date().toISOString()
        };

        this.save("latest_execution.json", record);
        appendJson(path.join(OUT_DIR, "execution_history.json"), record);
        return record;
    }

    async runOperation(operation, payload) {
        switch (operation) {
            case "HEALTH_CHECK":
                return await this.healthCheck();
            case "LIST_CAMPAIGNS":
                return await this.client.get(`/campaigns${payload.query || ""}`);
            case "GET_CAMPAIGN":
                return await this.client.get(`/campaigns/${encodeURIComponent(payload.campaignId || payload.id)}`);
            case "CREATE_CAMPAIGN":
                return await this.client.post("/campaigns", payload.campaign || payload);
            case "PAUSE_CAMPAIGN":
                return await this.client.patch(`/campaigns/${encodeURIComponent(payload.campaignId || payload.id)}`, { status: "paused" });
            case "RESUME_CAMPAIGN":
                return await this.client.patch(`/campaigns/${encodeURIComponent(payload.campaignId || payload.id)}`, { status: "active" });
            case "UPLOAD_LEADS":
                return await this.client.post(`/campaigns/${encodeURIComponent(payload.campaignId)}/leads`, { leads: payload.leads || [] });
            case "ASSIGN_SENDING_ACCOUNTS":
                return await this.client.post(`/campaigns/${encodeURIComponent(payload.campaignId)}/accounts`, { accounts: payload.accounts || [] });
            case "GENERATE_CAMPAIGN_REPORT":
                return await this.client.get(`/campaigns/${encodeURIComponent(payload.campaignId || payload.id)}/analytics`);
            default:
                return { ok: false, status: "UNSUPPORTED_OPERATION" };
        }
    }

    async verify(action = {}, execution = {}) {
        const operation = String(action.operation || action.action || "HEALTH_CHECK").toUpperCase();
        if (!execution.ok) {
            return { ok: false, verified: false, status: "EXECUTION_FAILED", provider: this.provider, operation, message: "Execution failed; cannot verify." };
        }
        if (execution.status === "SAFE_MODE_WRITE_DISABLED") {
            return { ok: true, verified: false, status: "SAFE_MODE_NOT_VERIFIED", provider: this.provider, operation, message: "Write operation was not executed because safe mode is enabled." };
        }
        if (operation === "CREATE_CAMPAIGN") {
            const campaignId = execution.result?.data?.id || execution.result?.data?.campaign?.id || execution.result?.data?.campaignId;
            if (!campaignId) return { ok: true, verified: false, status: "NO_CAMPAIGN_ID_RETURNED", provider: this.provider, operation };
            const check = await this.client.get(`/campaigns/${encodeURIComponent(campaignId)}`);
            return { ok: check.ok, verified: check.ok, status: check.ok ? "VERIFIED" : "VERIFY_FAILED", provider: this.provider, operation, campaignId, check };
        }
        return { ok: true, verified: Boolean(execution.ok), status: execution.ok ? "VERIFIED" : "VERIFY_FAILED", provider: this.provider, operation };
    }

    save(name, value) {
        writeJson(path.join(OUT_DIR, name), value);
    }
}

module.exports = new InstantlyLiveProviderController();
