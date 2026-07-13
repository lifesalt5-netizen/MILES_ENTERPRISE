"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");

class CampaignMonitoringEngine {
  constructor() {
    this.store = store;
    this.db = store.db;
    this.ensureTables();
  }

  now() {
    return new Date().toISOString();
  }

  ensureTables() {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS campaign_monitoring (
        id TEXT PRIMARY KEY,
        campaignId TEXT,
        campaignName TEXT,
        status TEXT,
        uploadQueueItems INTEGER,
        pendingApproval INTEGER,
        readyForUpload INTEGER,
        executed INTEGER,
        failed INTEGER,
        payload TEXT,
        createdAt TEXT
      )
    `).run();
  }

  run() {
    const campaigns = this.store.getCampaigns();
    const queue = this.store.getUploadQueue();

    const results = [];

    for (const campaign of campaigns) {
      const items = queue.filter(q => q.campaignId === campaign.id);

      const record = {
        id: this.store.id("CAMPMON"),
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        uploadQueueItems: items.length,
        pendingApproval: items.filter(x => x.status === "PENDING_APPROVAL").length,
        readyForUpload: items.filter(x => x.status === "READY_FOR_UPLOAD").length,
        executed: items.filter(x => ["UPLOADED", "DRY_RUN_COMPLETED"].includes(x.status)).length,
        failed: items.filter(x => String(x.status || "").includes("FAILED")).length,
        payload: {
          source: "CampaignMonitoringEngine",
          campaignPayload: campaign.payload || {}
        },
        createdAt: this.now()
      };

      this.db.prepare(`
        INSERT INTO campaign_monitoring
        (id,campaignId,campaignName,status,uploadQueueItems,pendingApproval,readyForUpload,executed,failed,payload,createdAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        record.id,
        record.campaignId,
        record.campaignName,
        record.status,
        record.uploadQueueItems,
        record.pendingApproval,
        record.readyForUpload,
        record.executed,
        record.failed,
        JSON.stringify(record.payload),
        record.createdAt
      );

      results.push(record);
    }

    this.store.insertEvent("CAMPAIGN_MONITORING_COMPLETED", "Marketing", {
      campaignsChecked: results.length
    });

    return results;
  }
}

module.exports = CampaignMonitoringEngine;
