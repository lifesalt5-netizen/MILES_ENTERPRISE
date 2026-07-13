"use strict";

/**
 * EXEC_006 Instantly Provider Compatibility Service
 * Complete replacement file.
 *
 * Purpose:
 * Exposes stable legacy and current method names so older MILES services
 * no longer fail with errors like `instantly.listCampaigns is not a function`.
 */

class InstantlyProviderCompatibilityService {
    constructor() {
        this.baseUrl = process.env.INSTANTLY_API_BASE_URL || "https://api.instantly.ai/api/v2";
    }

    status() {
        return {
            ok: true,
            provider: "instantly",
            providerName: "Instantly",
            executable: Boolean(process.env.INSTANTLY_API_KEY),
            credentialsPresent: Boolean(process.env.INSTANTLY_API_KEY),
            writeEnabled: String(process.env.INSTANTLY_WRITE_ENABLED || "").toLowerCase() === "true",
            safeMode: String(process.env.INSTANTLY_WRITE_ENABLED || "").toLowerCase() !== "true",
            supportedOperations: ["HEALTH_CHECK", "LIST_CAMPAIGNS", "GET_CAMPAIGN", "CREATE_CAMPAIGN", "PAUSE_CAMPAIGN", "RESUME_CAMPAIGN", "UPLOAD_LEADS", "ASSIGN_SENDING_ACCOUNTS", "GENERATE_CAMPAIGN_REPORT"],
            generatedAt: new Date().toISOString()
        };
    }

    async connect() {
        const status = this.status();
        return {
            ...status,
            action: "CONNECT",
            connected: status.credentialsPresent,
            status: status.credentialsPresent ? "READY" : "MISSING_CREDENTIALS",
            message: status.credentialsPresent ? "Instantly API key detected." : "INSTANTLY_API_KEY is not configured."
        };
    }

    async healthCheck() {
        if (!process.env.INSTANTLY_API_KEY) {
            return { ok: false, provider: "instantly", action: "HEALTH_CHECK", status: "MISSING_CREDENTIALS", message: "INSTANTLY_API_KEY is not configured." };
        }
        const response = await this.request("GET", "/campaigns?limit=1");
        return { ok: response.ok, provider: "instantly", action: "HEALTH_CHECK", status: response.ok ? "READY" : "ERROR", result: response, generatedAt: new Date().toISOString() };
    }

    async listCampaigns(input = {}) {
        const limit = Number(input.limit || 10);
        return this.request("GET", `/campaigns?limit=${encodeURIComponent(limit)}`);
    }

    async getCampaign(input = {}) {
        if (!input.id && !input.campaignId) return { ok: false, status: "MISSING_CAMPAIGN_ID" };
        return this.request("GET", `/campaigns/${encodeURIComponent(input.id || input.campaignId)}`);
    }

    async generateCampaignReport(input = {}) {
        const campaigns = await this.listCampaigns({ limit: input.limit || 10 });
        return { ok: campaigns.ok, action: "GENERATE_CAMPAIGN_REPORT", provider: "instantly", generatedAt: new Date().toISOString(), campaigns };
    }

    async execute(action = {}) {
        const operation = String(action.operation || action.action || "HEALTH_CHECK").toUpperCase();
        if (operation === "HEALTH_CHECK") return this.healthCheck(action.payload || action);
        if (operation === "LIST_CAMPAIGNS") return this.listCampaigns(action.payload || action);
        if (operation === "GET_CAMPAIGN") return this.getCampaign(action.payload || action);
        if (operation === "GENERATE_CAMPAIGN_REPORT") return this.generateCampaignReport(action.payload || action);
        return this.safeWrite(operation, action.payload || action);
    }

    async safeWrite(operation, payload) {
        const writeEnabled = String(process.env.INSTANTLY_WRITE_ENABLED || "").toLowerCase() === "true";
        if (!writeEnabled) {
            return { ok: true, provider: "instantly", operation, status: "SAFE_MODE_WRITE_DISABLED", executed: false, verified: false, payloadPreview: payload || {}, message: "Set INSTANTLY_WRITE_ENABLED=true for controlled live writes." };
        }
        return { ok: false, provider: "instantly", operation, status: "WRITE_NOT_IMPLEMENTED_IN_COMPATIBILITY_LAYER", executed: false, verified: false, message: "Use EXEC_004 controlled write service for Instantly writes." };
    }

    async request(method, endpoint, body) {
        if (!process.env.INSTANTLY_API_KEY) {
            return { ok: false, status: "MISSING_CREDENTIALS", message: "INSTANTLY_API_KEY is not configured." };
        }
        const url = `${this.baseUrl}${endpoint}`;
        const headers = { "Authorization": `Bearer ${process.env.INSTANTLY_API_KEY}`, "Content-Type": "application/json" };
        try {
            const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
            const text = await res.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = text; }
            return { ok: res.ok, status: res.ok ? "OK" : "HTTP_ERROR", httpStatus: res.status, method, endpoint, url, data, message: res.ok ? "Instantly API request succeeded." : "Instantly API request failed." };
        } catch (error) {
            return { ok: false, status: "REQUEST_FAILED", method, endpoint, url, error: error.message };
        }
    }
}

module.exports = new InstantlyProviderCompatibilityService();
