"use strict";

const fs = require("fs");
const path = require("path");
const axios = require("axios");

/**
 * 🧠 COO v11 — REAL WORLD AUTONOMOUS AGENT
 * Executes real external system actions (gated + auditable)
 */

class COO_V11_RealWorldAgent {

  constructor(config = {}) {

    // 🔐 CONTROL GATES (IMPORTANT)
    this.allowEmailSend = config.allowEmailSend || false;
    this.allowCRMWrite = config.allowCRMWrite || false;
    this.allowInstantly = config.allowInstantly || false;

    this.logDir = path.join(process.cwd(), "DATA", "v11_logs");
    fs.mkdirSync(this.logDir, { recursive: true });

    // API CONFIGS
    this.gmailConfig = config.gmail || {};
    this.instantlyConfig = config.instantly || {};
    this.crmConfig = config.crm || {};
  }

  // =========================
  // 📬 REAL GMAIL EXECUTION
  // =========================
  async sendEmail({ to, subject, body }) {

    if (!this.allowEmailSend) {
      return this._logBlocked("EMAIL_BLOCKED", { to, subject });
    }

    try {

      // REAL GMAIL API CALL (placeholder endpoint structure)
      const response = await axios.post(
        this.gmailConfig.endpoint,
        {
          to,
          subject,
          body
        },
        {
          headers: {
            Authorization: `Bearer ${this.gmailConfig.token}`
          }
        }
      );

      return this._logSuccess("EMAIL_SENT", response.data);

    } catch (err) {

      return this._logError("EMAIL_FAILED", err.message);
    }
  }

  // =========================
  // ⚡ INSTANTLY EXECUTION
  // =========================
  async addLeadToCampaign({ campaignId, lead }) {

    if (!this.allowInstantly) {
      return this._logBlocked("INSTANTLY_BLOCKED", { campaignId, lead });
    }

    try {

      const response = await axios.post(
        `${this.instantlyConfig.baseUrl}/leads/add`,
        {
          campaignId,
          lead
        },
        {
          headers: {
            Authorization: `Bearer ${this.instantlyConfig.token}`
          }
        }
      );

      return this._logSuccess("LEAD_ADDED", response.data);

    } catch (err) {

      return this._logError("INSTANTLY_FAILED", err.message);
    }
  }

  // =========================
  // 🧠 CRM WRITE OPERATIONS
  // =========================
  async updateCRM({ id, stage }) {

    if (!this.allowCRMWrite) {
      return this._logBlocked("CRM_BLOCKED", { id, stage });
    }

    try {

      const response = await axios.post(
        `${this.crmConfig.baseUrl}/update`,
        {
          id,
          stage
        },
        {
          headers: {
            Authorization: `Bearer ${this.crmConfig.token}`
          }
        }
      );

      return this._logSuccess("CRM_UPDATED", response.data);

    } catch (err) {

      return this._logError("CRM_FAILED", err.message);
    }
  }

  // =========================
  // 🔁 PIPELINE EXECUTION ROUTER
  // =========================
  async executeAction(action) {

    switch (action.type) {

      case "EMAIL_OUTREACH":
        return this.sendEmail(action.payload);

      case "INSTANTLY_ADD":
        return this.addLeadToCampaign(action.payload);

      case "CRM_UPDATE":
        return this.updateCRM(action.payload);

      default:
        return this._logBlocked("UNKNOWN_ACTION", action);
    }
  }

  // =========================
  // 📊 BATCH EXECUTOR (CORE V11)
  // =========================
  async executeBatch(actions = []) {

    const results = [];

    for (const action of actions) {

      const result = await this.executeAction(action);

      results.push(result);
    }

    return {
      ok: true,
      executed: results.length,
      results
    };
  }

  // =========================
  // 🧠 LOGGING ENGINE
  // =========================
  _logSuccess(type, data) {

    return this._log("success", type, data);
  }

  _logError(type, error) {

    return this._log("error", type, error);
  }

  _logBlocked(type, data) {

    return this._log("blocked", type, data);
  }

  _log(status, type, data) {

    const entry = {
      status,
      type,
      data,
      timestamp: new Date().toISOString()
    };

    const file = path.join(
      this.logDir,
      `v11-${new Date().toISOString().split("T")[0]}.json`
    );

    let existing = [];

    if (fs.existsSync(file)) {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    }

    existing.push(entry);

    fs.writeFileSync(file, JSON.stringify(existing, null, 2));

    return entry;
  }
}

module.exports = COO_V11_RealWorldAgent;