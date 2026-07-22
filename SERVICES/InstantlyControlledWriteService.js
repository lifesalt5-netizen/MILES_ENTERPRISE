"use strict";

// BUILD E002A PHASE 1
// Shared API helpers for governed Instantly controlled-write operations.
// This phase preserves existing behavior and prepares the service for
// PAUSE_TEST_CAMPAIGN and RESUME_TEST_CAMPAIGN implementation.

const policyService = require("./ControlledWritePolicyService");
const audit = require("./ControlledWriteAuditService");

class InstantlyControlledWriteService {
  constructor() {
    this.provider = "instantly";
    this.baseUrl = "https://api.instantly.ai/api/v2";
  }

  async execute(action = {}) {
    const startedAt = Date.now();
    const normalized = this.normalize(action);
    const policy = policyService.evaluate(normalized);

    if (!policy.allowed) {
      const result = this.buildResult({
        startedAt,
        operation: normalized.operation,
        ok: true,
        status: policy.status,
        executed: false,
        verified: false,
        dryRun: true,
        reason: policy.reason,
        payloadPreview: normalized.payload
      });

      this.recordAudit(result);
      return result;
    }

    switch (normalized.operation) {
      case "CREATE_TEST_CAMPAIGN":
        return await this.createTestCampaign(normalized, startedAt);

      case "PAUSE_TEST_CAMPAIGN":
      case "RESUME_TEST_CAMPAIGN":
        return await this.safeNotImplemented(normalized, startedAt);

      default: {
        const result = this.buildResult({
          startedAt,
          operation: normalized.operation,
          ok: false,
          status: "UNSUPPORTED_OPERATION",
          executed: false,
          verified: false
        });

        this.recordAudit(result);
        return result;
      }
    }
  }

  normalize(action = {}) {
    const payload =
      action.payload &&
      typeof action.payload === "object" &&
      !Array.isArray(action.payload)
        ? action.payload
        : {};

    return {
      provider: this.provider,
      operation: String(
        action.operation ||
        payload.operation ||
        "CREATE_TEST_CAMPAIGN"
      ).toUpperCase(),
      payload: {
        name:
          payload.name ||
          payload.title ||
          `MILES_TEST_${new Date()
            .toISOString()
            .replace(/[:.]/g, "-")}`,
        description:
          payload.description ||
          "Controlled write test campaign created by MILES OS.",
        ...payload
      },
      write: true,
      mode: "WRITE"
    };
  }

  getApiKey() {
    const apiKey = process.env.INSTANTLY_API_KEY;

    if (typeof apiKey !== "string") {
      return null;
    }

    const trimmed = apiKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async requestJson(method, endpoint, body, apiKey = this.getApiKey()) {
    const requestMethod = String(method || "GET").toUpperCase();

    const headers = {
      Authorization: `Bearer ${apiKey}`
    };

    const requestOptions = {
      method: requestMethod,
      headers
    };

    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(endpoint, requestOptions);
      const text = await response.text();

      let data;

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {
          raw: text
        };
      }

      return {
        ok: response.ok,
        requestFailed: false,
        httpStatus: response.status,
        endpoint,
        method: requestMethod,
        data
      };
    } catch (error) {
      return {
        ok: false,
        requestFailed: true,
        httpStatus: null,
        endpoint,
        method: requestMethod,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  buildResult(options = {}) {
    const startedAt =
      typeof options.startedAt === "number"
        ? options.startedAt
        : Date.now();

    const result = {
      ok: Boolean(options.ok),
      action: "INSTANTLY_CONTROLLED_WRITE",
      provider: this.provider,
      operation: options.operation || "UNKNOWN",
      status: options.status || "UNKNOWN",
      executed: Boolean(options.executed),
      verified: Boolean(options.verified)
    };

    const optionalFields = [
      "dryRun",
      "reason",
      "message",
      "error",
      "payloadPreview",
      "httpStatus",
      "endpoint",
      "requestBody",
      "response",
      "campaignId",
      "verification"
    ];

    for (const field of optionalFields) {
      if (options[field] !== undefined) {
        result[field] = options[field];
      }
    }

    result.durationMs = Date.now() - startedAt;
    result.generatedAt = new Date().toISOString();

    return result;
  }

  recordAudit(result) {
    audit.record({
      provider: this.provider,
      operation: result.operation,
      status: result.status,
      executed: Boolean(result.executed),
      verified: Boolean(result.verified),
      result
    });
  }

  missingCredentialsResult(action, startedAt) {
    const result = this.buildResult({
      startedAt,
      operation: action.operation,
      ok: false,
      status: "MISSING_CREDENTIALS",
      executed: false,
      verified: false,
      message: "INSTANTLY_API_KEY is not configured."
    });

    this.recordAudit(result);
    return result;
  }

  requestFailedResult(action, startedAt, request) {
    const result = this.buildResult({
      startedAt,
      operation: action.operation,
      ok: false,
      status: "REQUEST_FAILED",
      executed: false,
      verified: false,
      error: request.error,
      endpoint: request.endpoint
    });

    this.recordAudit(result);
    return result;
  }

  async createTestCampaign(action, startedAt) {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      return this.missingCredentialsResult(action, startedAt);
    }

    const endpoint = `${this.baseUrl}/campaigns`;

    const body = {
      name: action.payload.name,
      pl_value: Number(action.payload.pl_value || 2500),
      open_tracking: false,
      stop_on_reply: true
    };

    const request = await this.requestJson(
      "POST",
      endpoint,
      body,
      apiKey
    );

    if (request.requestFailed) {
      return this.requestFailedResult(
        action,
        startedAt,
        request
      );
    }

    const data = request.data || {};
    const campaignId =
      data.id ||
      data.campaign_id ||
      null;

    const result = this.buildResult({
      startedAt,
      operation: action.operation,
      ok: request.ok,
      status: request.ok ? "EXECUTED" : "API_ERROR",
      executed: request.ok,
      verified: false,
      httpStatus: request.httpStatus,
      endpoint,
      requestBody: body,
      response: data,
      campaignId
    });

    if (campaignId) {
      result.verification = await this.verifyCampaign(
        campaignId,
        apiKey
      );

      result.verified = Boolean(
        result.verification &&
        result.verification.verified
      );

      result.status = result.verified
        ? "VERIFIED"
        : "EXECUTED_NOT_VERIFIED";
    }

    result.durationMs = Date.now() - startedAt;
    result.generatedAt = new Date().toISOString();

    this.recordAudit(result);
    return result;
  }

  async getCampaign(campaignId, apiKey = this.getApiKey()) {
    const endpoint =
      `${this.baseUrl}/campaigns/${encodeURIComponent(campaignId)}`;

    if (!apiKey) {
      return {
        ok: false,
        requestFailed: false,
        httpStatus: null,
        endpoint,
        method: "GET",
        data: null,
        error: "INSTANTLY_API_KEY is not configured."
      };
    }

    return await this.requestJson(
      "GET",
      endpoint,
      undefined,
      apiKey
    );
  }

  async verifyCampaign(campaignId, apiKey = this.getApiKey()) {
    const endpoint =
      `${this.baseUrl}/campaigns/${encodeURIComponent(campaignId)}`;

    if (!apiKey) {
      return {
        ok: false,
        action: "VERIFY_INSTANTLY_CAMPAIGN",
        verified: false,
        error: "INSTANTLY_API_KEY is not configured.",
        endpoint,
        generatedAt: new Date().toISOString()
      };
    }

    const request = await this.getCampaign(
      campaignId,
      apiKey
    );

    if (request.requestFailed) {
      return {
        ok: false,
        action: "VERIFY_INSTANTLY_CAMPAIGN",
        verified: false,
        error: request.error,
        endpoint: request.endpoint,
        generatedAt: new Date().toISOString()
      };
    }

    return {
      ok: request.ok,
      action: "VERIFY_INSTANTLY_CAMPAIGN",
      verified: request.ok,
      httpStatus: request.httpStatus,
      endpoint: request.endpoint,
      data: request.data,
      generatedAt: new Date().toISOString()
    };
  }

  async safeNotImplemented(action, startedAt) {
    const result = this.buildResult({
      startedAt,
      operation: action.operation,
      ok: true,
      status:
        "CONTROLLED_WRITE_GUARD_READY_NOT_IMPLEMENTED",
      executed: false,
      verified: false,
      message:
        "Guardrail is installed; live operation implementation will be enabled after create-test-campaign validation."
    });

    this.recordAudit(result);
    return result;
  }

  async run(input = {}) {
    return await this.execute(input);
  }
}

module.exports = new InstantlyControlledWriteService();
