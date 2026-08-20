"use strict";

const ReplacementContactBackfillService = require("./ReplacementContactBackfillService");
const BusinessOperationsBridgeService = require("../BusinessOperationsBridgeService");

class ReplacementContactAutonomousExecutionService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || process.cwd();
    this.backfill = options.backfill || new ReplacementContactBackfillService({ rootDir: this.rootDir });
    this.bridge = options.bridge || new BusinessOperationsBridgeService({ rootDir: this.rootDir });
  }

  async runOnce() {
    const backfill = await this.backfill.runOnce();
    if (!backfill || backfill.ok !== true) {
      return {
        ok: false,
        status: "REPLACEMENT_CONTACT_BACKFILL_FAILED",
        backfill,
        bridge: null
      };
    }

    const bridge = await this.bridge.runOnce();
    const queued = Number(bridge?.operationsQueued ?? bridge?.queued ?? 0);
    const failed = Number(bridge?.operationsFailed ?? bridge?.failed ?? 0);

    return {
      ok: failed === 0,
      status: failed === 0 ? "REPLACEMENT_CONTACT_EXECUTION_COMPLETE" : "REPLACEMENT_CONTACT_EXECUTION_PARTIAL",
      backfill,
      bridge,
      operationsQueued: queued,
      operationsFailed: failed
    };
  }
}

module.exports = ReplacementContactAutonomousExecutionService;
