"use strict";

const policyService = require("./ControlledWritePolicyService");
const audit = require("./ControlledWriteAuditService");

class InstantlyControlledWriteService {
  constructor() {
    this.provider = "instantly";
  }

  async execute(action = {}) {
    const startedAt = Date.now();
    const normalized = this.normalize(action);
    const policy = policyService.evaluate(normalized);

    if (!policy.allowed) {
      const result = {
        ok: true,
        action: "INSTANTLY_CONTROLLED_WRITE",
        provider: this.provider,
        operation: normalized.operation,
        status: policy.status,
        executed: false,
        verified: false,
        dryRun: true,
        reason: policy.reason,
        payloadPreview: normalized.payload,
        durationMs: Date.now() - startedAt,
        generatedAt: new Date().toISOString()
      };
      audit.record({ provider: this.provider, operation: normalized.operation, status: result.status, executed: false, result });
      return result;
    }

    if (normalized.operation === "CREATE_TEST_CAMPAIGN") return await this.createTestCampaign(normalized, startedAt);
    if (["PAUSE_TEST_CAMPAIGN", "RESUME_TEST_CAMPAIGN"].includes(normalized.operation)) return await this.safeNotImplemented(normalized, startedAt);

    const result = {
      ok: false,
      action: "INSTANTLY_CONTROLLED_WRITE",
      provider: this.provider,
      operation: normalized.operation,
      status: "UNSUPPORTED_OPERATION",
      executed: false,
      verified: false,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString()
    };
    audit.record({ provider: this.provider, operation: normalized.operation, status: result.status, executed: false, result });
    return result;
  }

  normalize(action = {}) {
    const payload = action.payload || {};
    return {
      provider: this.provider,
      operation: String(action.operation || payload.operation || "CREATE_TEST_CAMPAIGN").toUpperCase(),
      payload: {
        name: payload.name || payload.title || `MILES_TEST_${new Date().toISOString().replace(/[:.]/g, "-")}`,
        description: payload.description || "Controlled write test campaign created by MILES OS.",
        ...payload
      },
      write: true,
      mode: "WRITE"
    };
  }

  async createTestCampaign(action, startedAt) {
    const apiKey = process.env.INSTANTLY_API_KEY;
    if (!apiKey) {
      const result = {
        ok: false,
        action: "INSTANTLY_CONTROLLED_WRITE",
        provider: this.provider,
        operation: action.operation,
        status: "MISSING_CREDENTIALS",
        executed: false,
        verified: false,
        message: "INSTANTLY_API_KEY is not configured.",
        durationMs: Date.now() - startedAt,
        generatedAt: new Date().toISOString()
      };
      audit.record({ provider: this.provider, operation: action.operation, status: result.status, executed: false, result });
      return result;
    }

    const endpoint = "https://api.instantly.ai/api/v2/campaigns";
    const body = {
      name: action.payload.name,
      pl_value: Number(action.payload.pl_value || 2500),
      open_tracking: false,
      stop_on_reply: true
    };

    let response;
    let data;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    } catch (error) {
      const result = {
        ok: false,
        action: "INSTANTLY_CONTROLLED_WRITE",
        provider: this.provider,
        operation: action.operation,
        status: "REQUEST_FAILED",
        executed: false,
        verified: false,
        error: error.message,
        durationMs: Date.now() - startedAt,
        generatedAt: new Date().toISOString()
      };
      audit.record({ provider: this.provider, operation: action.operation, status: result.status, executed: false, result });
      return result;
    }

    const executed = response.ok;
    const campaignId = data?.id || data?.campaign_id || null;
    const result = {
      ok: response.ok,
      action: "INSTANTLY_CONTROLLED_WRITE",
      provider: this.provider,
      operation: action.operation,
      status: response.ok ? "EXECUTED" : "API_ERROR",
      executed,
      verified: false,
      httpStatus: response.status,
      endpoint,
      requestBody: body,
      response: data,
      campaignId,
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString()
    };

    if (campaignId) {
      result.verification = await this.verifyCampaign(campaignId, apiKey);
      result.verified = Boolean(result.verification?.verified);
      result.status = result.verified ? "VERIFIED" : "EXECUTED_NOT_VERIFIED";
    }

    audit.record({ provider: this.provider, operation: action.operation, status: result.status, executed: result.executed, verified: result.verified, result });
    return result;
  }

  async verifyCampaign(campaignId, apiKey) {
    const endpoint = `https://api.instantly.ai/api/v2/campaigns/${campaignId}`;
    try {
      const response = await fetch(endpoint, { headers: { "Authorization": `Bearer ${apiKey}` } });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      return { ok: response.ok, action: "VERIFY_INSTANTLY_CAMPAIGN", verified: response.ok, httpStatus: response.status, endpoint, data, generatedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, action: "VERIFY_INSTANTLY_CAMPAIGN", verified: false, error: error.message, endpoint, generatedAt: new Date().toISOString() };
    }
  }

  async safeNotImplemented(action, startedAt) {
    const result = {
      ok: true,
      action: "INSTANTLY_CONTROLLED_WRITE",
      provider: this.provider,
      operation: action.operation,
      status: "CONTROLLED_WRITE_GUARD_READY_NOT_IMPLEMENTED",
      executed: false,
      verified: false,
      message: "Guardrail is installed; live operation implementation will be enabled after create-test-campaign validation.",
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString()
    };
    audit.record({ provider: this.provider, operation: action.operation, status: result.status, executed: false, result });
    return result;
  }

  async run(input = {}) {
    return await this.execute(input);
  }
}
module.exports = new InstantlyControlledWriteService();
