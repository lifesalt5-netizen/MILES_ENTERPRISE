"use strict";

const EnterpriseScheduler = require("./EnterpriseScheduler");
const MarketingExecutionEngine = require("../EXECUTION/MarketingExecutionEngine");
const ApprovalQueueEngine = require("../GOVERNANCE/ApprovalQueueEngine");

function registerMarketingWorkflow(scheduler) {
  scheduler.register("marketing_approval_status", async () => {
    const approvals = new ApprovalQueueEngine();

    return {
      pending: approvals.pendingSummary(),
      stats: approvals.stats()
    };
  });

  scheduler.register("marketing_execute_ready_uploads", async () => {
    const engine = new MarketingExecutionEngine();
    return await engine.run();
  });
}

module.exports = registerMarketingWorkflow;
