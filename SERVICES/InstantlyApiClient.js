"use strict";

/**
 * EXEC_003 Instantly API Client
 * Complete replacement file.
 *
 * Purpose:
 * Low-level Instantly API transport used by Miles provider controllers.
 * Uses Node 18+ global fetch. Credentials are read from environment only.
 *
 * Required env:
 * - INSTANTLY_API_KEY
 * Optional env:
 * - INSTANTLY_BASE_URL default: https://api.instantly.ai/api/v2
 */

class InstantlyApiClient {
    constructor(options = {}) {
        this.baseUrl = String(options.baseUrl || process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2").replace(/\/+$/, "");
        this.apiKey = options.apiKey || process.env.INSTANTLY_API_KEY || "";
        this.timeoutMs = Number(options.timeoutMs || process.env.INSTANTLY_TIMEOUT_MS || 30000);
    }

    credentialsPresent() {
        return Boolean(this.apiKey && this.apiKey.trim().length > 10);
    }

    headers(extra = {}) {
        return {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            ...extra
        };
    }

    async request(method, endpoint, body = null, options = {}) {
        if (!this.credentialsPresent()) {
            return {
                ok: false,
                status: "MISSING_CREDENTIALS",
                provider: "instantly",
                endpoint,
                method,
                message: "INSTANTLY_API_KEY is not configured."
            };
        }

        const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                method,
                headers: this.headers(options.headers || {}),
                body: body === null || body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });

            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch {
                data = { raw: text };
            }

            return {
                ok: response.ok,
                status: response.ok ? "OK" : "HTTP_ERROR",
                httpStatus: response.status,
                provider: "instantly",
                method,
                endpoint,
                url,
                data,
                message: response.ok ? "Instantly API request succeeded." : "Instantly API request failed."
            };
        } catch (error) {
            return {
                ok: false,
                status: error.name === "AbortError" ? "TIMEOUT" : "REQUEST_ERROR",
                provider: "instantly",
                method,
                endpoint,
                url,
                error: error.message,
                message: "Instantly API request failed before completion."
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async get(endpoint) { return this.request("GET", endpoint); }
    async post(endpoint, body) { return this.request("POST", endpoint, body); }
    async patch(endpoint, body) { return this.request("PATCH", endpoint, body); }
    async put(endpoint, body) { return this.request("PUT", endpoint, body); }
    async delete(endpoint, body = null) { return this.request("DELETE", endpoint, body); }
}

module.exports = InstantlyApiClient;
