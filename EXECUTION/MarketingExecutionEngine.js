"use strict";

const store = require("../CORE/CANONICAL/EnterpriseStore");
const providers = require("../PROVIDERS/ProviderRegistry");

class MarketingExecutionEngine {
  constructor() {
    this.store = store;
    this.providers = providers;
  }

  async run() {
    const ready = this.store.getUploadQueue("READY_FOR_UPLOAD");
    let executed = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of ready) {
      try {
        const provider = this.providers.get("instantly");

        const result = await provider.uploadSegment({
          queueId: item.id,
          segmentId: item.segmentId,
          segmentName: item.segmentName,
          campaignId: item.campaignId,
          campaignName: item.campaignName,
          requestedUploadCount: item.requestedUploadCount,
          approvedUploadCount: item.approvedUploadCount,
          domain: item.domain
        });

        this.store.createUploadQueueItem(Object.assign({}, item, {
          status: result.dryRun ? "DRY_RUN_COMPLETED" : "UPLOADED",
          payload: Object.assign({}, item.payload || {}, {
            executionResult: result,
            executedAt: new Date().toISOString()
          })
        }));

        this.store.insertEvent("MARKETING_UPLOAD_EXECUTED", "Marketing", {
          queueId: item.id,
          dryRun: result.dryRun,
          provider: "instantly"
        });

        executed++;
      } catch (error) {
        this.store.createUploadQueueItem(Object.assign({}, item, {
          status: "UPLOAD_FAILED",
          payload: Object.assign({}, item.payload || {}, {
            error: error.message,
            failedAt: new Date().toISOString()
          })
        }));

        failed++;
      }
    }

    return {
      readySeen: ready.length,
      executed,
      skipped,
      failed,
      providerMode: process.env.INSTANTLY_PROVIDER_MODE || "DRY_RUN"
    };
  }
}

module.exports = MarketingExecutionEngine;
