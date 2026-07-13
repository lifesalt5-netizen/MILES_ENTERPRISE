"use strict";

const axios = require("axios");

/**
 * REAL WORLD INTEGRATION LAYER
 * - Gmail (via API placeholder)
 * - Instantly (API)
 * - CRM (HubSpot/Airtable/etc)
 * - ORION (your master DB)
 * - Webhooks (event ingestion)
 */

class RealWorldIntegrationLayer {

  constructor(config = {}) {

    this.gmail = config.gmail || null;
    this.instantly = config.instantly || null;
    this.crm = config.crm || null;
    this.orion = config.orion || null;

    this.debug = config.debug || false;
  }

  // =========================
  // 📬 GMAIL INTEGRATION
  // =========================
  async sendEmail(payload) {

    try {

      if (!this.gmail?.enabled) {
        return this._log("gmail_disabled", payload);
      }

      // REAL GMAIL API PLACEHOLDER
      const result = await axios.post(
        this.gmail.endpoint,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.gmail.token}`
          }
        }
      );

      return this._log("gmail_sent", result.data);

    } catch (err) {
      return this._log("gmail_error", err.message);
    }
  }

  // =========================
  // ⚡ INSTANTLY OUTBOUND
  // =========================
  async runInstantlyCampaign(payload) {

    try {

      if (!this.instantly?.enabled) {
        return this._log("instantly_disabled", payload);
      }

      const result = await axios.post(
        `${this.instantly.baseUrl}/campaigns/run`,
        payload,
        {
          headers: {
            Authorization: this.instantly.apiKey
          }
        }
      );

      return this._log("instantly_success", result.data);

    } catch (err) {
      return this._log("instantly_error", err.message);
    }
  }

  // =========================
  // 🧠 CRM INTEGRATION
  // =========================
  async updateCRM(payload) {

    try {

      if (!this.crm?.enabled) {
        return this._log("crm_disabled", payload);
      }

      const result = await axios.post(
        this.crm.endpoint,
        payload,
        {
          headers: {
            Authorization: this.crm.token
          }
        }
      );

      return this._log("crm_updated", result.data);

    } catch (err) {
      return this._log("crm_error", err.message);
    }
  }

  // =========================
  // 🧠 ORION MEMORY WRITE
  // =========================
  async writeToOrion(data) {

    try {

      if (!this.orion?.enabled) {
        return this._log("orion_disabled", data);
      }

      const result = await axios.post(
        this.orion.endpoint + "/write",
        data,
        {
          headers: {
            Authorization: this.orion.token
          }
        }
      );

      return this._log("orion_written", result.data);

    } catch (err) {
      return this._log("orion_error", err.message);
    }
  }

  // =========================
  // 🌐 WEBHOOK EVENT INGESTION
  // =========================
  async ingestEvent(event) {

    return this._log("event_ingested", event);
  }

  // =========================
  // 🔁 INTERNAL LOGGER
  // =========================
  _log(type, data) {

    if (this.debug) {
      console.log(`[REAL-WORLD] ${type}`, data);
    }

    return {
      ok: true,
      type,
      data,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = RealWorldIntegrationLayer;