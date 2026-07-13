"use strict";

const IDataProvider = require("../contracts/IDataProvider");
const website = require("../../CONNECTORS/WEBSITE/website");

class WebsiteProvider extends IDataProvider {
  constructor() {
    super("Website");

    this.dependencies = ["Website"];
    this.sourceSystems = ["CONNECTORS/WEBSITE"];
  }

  async initialize() {
    return this.verifyWebsite();
  }

  async refresh() {
    return this.verifyWebsite();
  }

  async verifyWebsite() {
    this.lastRefresh = new Date().toISOString();
    this.dataFreshness = "Live";

    try {
      const result = await website.auditWebsite();

      this.status = result.ok ? "Healthy" : "Critical";
      this.metrics = result.metrics || {};
      this.exceptions = result.ok
        ? []
        : [{
            type: "WebsiteUnavailable",
            severity: "Critical",
            message: result.error || "Website audit failed."
          }];

      this.recommendations = result.ok
        ? []
        : [
            "Verify B12 website availability.",
            "Verify DNS.",
            "Verify SSL."
          ];

      return {
        ok: Boolean(result.ok),
        provider: "WebsiteProvider",
        action: "verifyWebsite",
        status: this.status,
        metrics: this.metrics,
        exceptions: this.exceptions,
        recommendations: this.recommendations,
        verifiedAt: this.lastRefresh
      };
    } catch (err) {
      this.status = "Critical";
      this.metrics = {};
      this.exceptions = [{
        type: "WebsiteAudit",
        severity: "Critical",
        message: err.stack || err.message
      }];
      this.recommendations = [
        "Verify Website connector.",
        "Verify P2GC_WEBSITE_URL.",
        "Verify outbound HTTPS access."
      ];

      return {
        ok: false,
        provider: "WebsiteProvider",
        action: "verifyWebsite",
        status: this.status,
        metrics: this.metrics,
        exceptions: this.exceptions,
        recommendations: this.recommendations,
        verifiedAt: this.lastRefresh
      };
    }
  }

  async executeTask(task = {}) {
    const payload = task.payload || task || {};
    const action = payload.action || "verifyWebsite";

    if (typeof this[action] !== "function") {
      throw new Error(`Unsupported WebsiteProvider action: ${action}`);
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports = WebsiteProvider;
