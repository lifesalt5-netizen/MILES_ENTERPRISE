"use strict";

const fs = require("fs");
const path = require("path");
const axios = require("axios");

class COOExecutionLayer {

  constructor(config = {}) {

    this.gmailEnabled = config.gmailEnabled ?? false;
    this.instantlyEnabled = config.instantlyEnabled ?? false;
    this.crmEnabled = config.crmEnabled ?? false;

    this.logDir = path.join(process.cwd(), "DATA", "execution_logs");
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  // =========================
  // 📬 GMAIL EXECUTOR
  // =========================
  async sendEmail({ to, subject, body }) {

    if (!this.gmailEnabled) {
      return { ok: false, reason: "Gmail disabled" };
    }

    // PLACEHOLDER: replace with Gmail API / OAuth later
    const log = {
      type: "gmail_send",
      to,
      subject,
      body,
      timestamp: new Date().toISOString()
    };

    this._log(log);

    return { ok: true, mode: "gmail_simulated", log };
  }

  async draftEmail({ to, subject, body }) {

    const log = {
      type: "gmail_draft",
      to,
      subject,
      body,
      timestamp: new Date().toISOString()
    };

    this._log(log);

    return { ok: true, draft: log };
  }

  // =========================
  // ⚡ INSTANTLY EXECUTOR
  // =========================
  async addToCampaign({ campaignId, lead }) {

    if (!this.instantlyEnabled) {
      return { ok: false, reason: "Instantly disabled" };
    }

    const log = {
      type: "instantly_add_lead",
      campaignId,
      lead,
      timestamp: new Date().toISOString()
    };

    this._log(log);

    return { ok: true, mode: "instantly_simulated", log };
  }

  async createCampaign({ name }) {

    const log = {
      type: "instantly_create_campaign",
      name,
      timestamp: new Date().toISOString()
    };

    this._log(log);

    return { ok: true, campaign: log };
  }

  // =========================
  // 🧠 CRM EXECUTOR
  // =========================
  async upsertLead({ id, name, stage }) {

    if (!this.crmEnabled) {
      return { ok: false, reason: "CRM disabled" };
    }

    const log = {
      type: "crm_upsert",
      id,
      name,
      stage,
      timestamp: new Date().toISOString()
    };

    this._log(log);

    return { ok: true, lead: log };
  }

  async movePipeline({ id, stage }) {

    const log = {
      type: "crm_move_pipeline",
      id,
      stage,
      timestamp: new Date().toISOString()
    };

    this._log(log);

    return { ok: true, update: log };
  }

  // =========================
  // 🌐 GENERIC API EXECUTOR
  // =========================
  async callAPI({ url, method = "GET", data = null }) {

    try {

      const res = await axios({
        url,
        method,
        data,
        timeout: 15000
      });

      const log = {
        type: "api_call",
        url,
        method,
        status: res.status,
        timestamp: new Date().toISOString()
      };

      this._log(log);

      return { ok: true, response: res.data };

    } catch (err) {

      const log = {
        type: "api_error",
        url,
        error: err.message,
        timestamp: new Date().toISOString()
      };

      this._log(log);

      return { ok: false, error: err.message };
    }
  }

  // =========================
  // 🔐 LOGGING ENGINE
  // =========================
  _log(entry) {

    const file = path.join(
      this.logDir,
      `exec-${new Date().toISOString().split("T")[0]}.json`
    );

    let existing = [];

    if (fs.existsSync(file)) {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
    }

    existing.push(entry);

    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  }
}

module.exports = COOExecutionLayer;