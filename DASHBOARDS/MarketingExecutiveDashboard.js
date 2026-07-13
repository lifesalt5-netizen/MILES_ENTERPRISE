"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class MarketingExecutiveDashboard {
  constructor() {
    this.store = store;
    this.db = store.db;
  }

  countBy(rows, field) {
    const out = {};
    for (const row of rows) {
      const key = String(row[field] ?? "UNKNOWN");
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  }

  latestCampaignMonitoring() {
    const exists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_monitoring'"
    ).get();

    if (!exists) return [];

    return this.db.prepare(`
      SELECT *
      FROM campaign_monitoring
      WHERE createdAt = (
        SELECT MAX(createdAt)
        FROM campaign_monitoring
      )
      ORDER BY campaignName ASC
    `).all();
  }

  build() {
    const campaigns = this.store.getCampaigns();
    const segments = this.store.getSegments();
    const domains = this.store.getDomains();
    const inboxes = this.store.getInboxes();
    const approvals = this.db.prepare("SELECT * FROM approvals").all();
    const queue = this.store.getUploadQueue();
    const monitoring = this.latestCampaignMonitoring();

    const dashboard = {
      generatedAt: new Date().toISOString(),
      campaigns: {
        total: campaigns.length,
        byStatus: this.countBy(campaigns, "status")
      },
      uploadQueue: {
        total: queue.length,
        byStatus: this.countBy(queue, "status")
      },
      approvals: {
        total: approvals.length,
        byStatus: this.countBy(approvals, "status")
      },
      segments: {
        total: segments.length,
        readyForUpload: segments.filter(s => s.readyForUpload === 1).length,
        byUploadStatus: this.countBy(segments, "uploadStatus")
      },
      domains: {
        total: domains.length,
        byStatus: this.countBy(domains, "status")
      },
      inboxes: {
        total: inboxes.length,
        usable: this.store.getUsableInboxes().length,
        totalDailyCapacity: this.store.getUsableInboxes().reduce((sum, i) => sum + Number(i.dailyLimit || 0), 0),
        byStatus: this.countBy(inboxes, "status")
      },
      campaignMonitoring: {
        campaignsChecked: monitoring.length,
        totalQueueItems: monitoring.reduce((sum, x) => sum + Number(x.uploadQueueItems || 0), 0),
        totalExecuted: monitoring.reduce((sum, x) => sum + Number(x.executed || 0), 0),
        totalFailed: monitoring.reduce((sum, x) => sum + Number(x.failed || 0), 0)
      },
      provider: {
        instantlyMode: process.env.INSTANTLY_PROVIDER_MODE || "EXPORT_CSV"
      }
    };

    this.store.insertEvent("MARKETING_EXECUTIVE_DASHBOARD_BUILT", "Marketing", dashboard);
    return dashboard;
  }
}

module.exports = MarketingExecutiveDashboard;
