"use strict";

const crypto = require("crypto");
const EnterpriseStore = require("../CORE/CANONICAL/EnterpriseStore");

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stableId(prefix, ...parts) {
  const source = parts
    .map(value => String(value ?? "").trim().toUpperCase())
    .join("|");

  const hash = crypto
    .createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();

  return `${prefix}_${hash}`;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

class MarketingRevenueDecisionService {
  constructor(store = EnterpriseStore) {
    this.store = store;
    this.department = "Revenue Operations";
  }

  getRecommendations() {
    if (this.store.mode === "sqlite") {
      return this.store.db
        .prepare(`
          SELECT
            id,
            segmentId,
            segmentName,
            campaignId,
            campaignName,
            priority,
            recommendedUpload,
            reason,
            status,
            createdAt
          FROM marketing_recommendations
          ORDER BY priority DESC, createdAt ASC
        `)
        .all();
    }

    return (
      this.store.json.marketingRecommendations ||
      this.store.json.marketing_recommendations ||
      []
    );
  }

  getExistingTasks() {
    if (this.store.mode === "sqlite") {
      return this.store.db
        .prepare("SELECT id, status, payload FROM tasks")
        .all()
        .map(row => ({
          ...row,
          payload: parseJson(row.payload)
        }));
    }

    return this.store.json.tasks || [];
  }

  getExistingQueue() {
    if (typeof this.store.getUploadQueue === "function") {
      return this.store.getUploadQueue();
    }

    if (this.store.mode === "sqlite") {
      return this.store.db
        .prepare("SELECT * FROM marketing_upload_queue")
        .all()
        .map(row => ({
          ...row,
          payload: parseJson(row.payload)
        }));
    }

    return this.store.json.marketingUploadQueue || [];
  }

  getExistingApprovals() {
    if (this.store.mode === "sqlite") {
      return this.store.db
        .prepare("SELECT id, status, payload FROM approvals")
        .all()
        .map(row => ({
          ...row,
          payload: parseJson(row.payload)
        }));
    }

    return this.store.json.approvals || [];
  }

  determineProtection(recommendation) {
    const payload = parseJson(recommendation.payload);

    return Boolean(
      recommendation.requiresKevin === true ||
      recommendation.requiresKevin === 1 ||
      payload.requiresKevin === true ||
      payload.requiresKevin === 1
    );
  }

  makeDecisionKey(recommendation) {
    return [
      recommendation.id,
      recommendation.segmentId,
      recommendation.segmentName,
      recommendation.campaignId,
      normalizeStatus(recommendation.status)
    ]
      .filter(Boolean)
      .join("|");
  }

  createRevenueTargetWork(recommendation, state, summary) {
    const decisionKey = this.makeDecisionKey(recommendation);
    const requiresKevin = this.determineProtection(recommendation);
    const requestedUploadCount = Math.max(
      0,
      asNumber(recommendation.recommendedUpload)
    );

    const hasCampaign = Boolean(
      String(recommendation.campaignId || "").trim() ||
      String(recommendation.campaignName || "").trim()
    );

    if (!hasCampaign) {
      return this.createNeedsBuildTask(
        recommendation,
        state,
        summary,
        "Campaign assignment is missing. Resolve the campaign gap before upload."
      );
    }

    if (requestedUploadCount <= 0) {
      summary.invalidRevenueTargets += 1;
      summary.skippedItems += 1;

      this.store.insertEvent(
        "MARKETING_REVENUE_TARGET_SKIPPED",
        this.department,
        {
          recommendationId: recommendation.id,
          segmentId: recommendation.segmentId,
          segmentName: recommendation.segmentName,
          reason: "Recommended upload count is zero."
        }
      );

      return;
    }

    const taskId = stableId("TASK_MKT_REV", decisionKey);
    const queueId = stableId("UPLOAD_REV", decisionKey);
    const approvalId = requiresKevin
      ? stableId("APPROVAL_MKT_REV", decisionKey)
      : null;

    let approval = null;

    if (requiresKevin) {
      if (!state.approvalIds.has(approvalId)) {
        approval = this.store.createApproval({
          id: approvalId,
          department: this.department,
          title: `Approve ${requestedUploadCount} lead upload for ${recommendation.segmentName}`,
          status: "PENDING",
          payload: {
            source: "MarketingRevenueDecisionService",
            decisionType: "REVENUE_TARGET",
            recommendationId: recommendation.id,
            segmentId: recommendation.segmentId,
            segmentName: recommendation.segmentName,
            campaignId: recommendation.campaignId,
            campaignName: recommendation.campaignName,
            requestedUploadCount,
            reason: recommendation.reason
          }
        });

        state.approvalIds.add(approvalId);
        summary.approvalsCreated += 1;
      } else {
        summary.duplicateApprovalsSkipped += 1;
      }
    }

    if (!state.taskIds.has(taskId)) {
      this.store.addTask({
        id: taskId,
        department: this.department,
        title: `Upload ${requestedUploadCount} verified leads from ${recommendation.segmentName}`,
        status: requiresKevin ? "PENDING_APPROVAL" : "READY",
        priority: asNumber(recommendation.priority, 50),
        requiresKevin,
        payload: {
          source: "MarketingRevenueDecisionService",
          decisionType: "REVENUE_TARGET",
          recommendationId: recommendation.id,
          segmentId: recommendation.segmentId,
          segmentName: recommendation.segmentName,
          campaignId: recommendation.campaignId,
          campaignName: recommendation.campaignName,
          requestedUploadCount,
          approvalId: approval ? approval.id : approvalId,
          reason: recommendation.reason
        }
      });

      state.taskIds.add(taskId);
      summary.tasksCreated += 1;
      summary.revenueTasksCreated += 1;
    } else {
      summary.duplicateTasksSkipped += 1;
    }

    if (!state.queueIds.has(queueId)) {
      this.store.createUploadQueueItem({
        id: queueId,
        segmentId: recommendation.segmentId,
        segmentName: recommendation.segmentName,
        campaignId: recommendation.campaignId,
        campaignName: recommendation.campaignName,
        requestedUploadCount,
        approvedUploadCount: requiresKevin ? 0 : requestedUploadCount,
        status: requiresKevin ? "PENDING_APPROVAL" : "READY",
        priority: asNumber(recommendation.priority, 50),
        requiresKevin,
        approvalId,
        reason: recommendation.reason,
        payload: {
          source: "MarketingRevenueDecisionService",
          decisionType: "REVENUE_TARGET",
          recommendationId: recommendation.id,
          taskId,
          segmentId: recommendation.segmentId,
          segmentName: recommendation.segmentName,
          campaignId: recommendation.campaignId,
          campaignName: recommendation.campaignName,
          requestedUploadCount,
          requiresKevin,
          approvalId
        }
      });

      state.queueIds.add(queueId);
      summary.uploadQueueItems += 1;
      summary.queuedItems += 1;
    } else {
      summary.duplicateQueueItemsSkipped += 1;
      summary.skippedItems += 1;
    }

    this.store.insertEvent(
      "MARKETING_REVENUE_DECISION_CREATED",
      this.department,
      {
        recommendationId: recommendation.id,
        decisionType: "REVENUE_TARGET",
        taskId,
        queueId,
        approvalId,
        requiresKevin
      }
    );
  }

  createDataAssetTask(recommendation, state, summary) {
    const decisionKey = this.makeDecisionKey(recommendation);
    const taskId = stableId("TASK_MKT_ASSET", decisionKey);

    if (state.taskIds.has(taskId)) {
      summary.duplicateTasksSkipped += 1;
      summary.skippedItems += 1;
      return;
    }

    this.store.addTask({
      id: taskId,
      department: "Marketing Intelligence",
      title: `Maintain marketing data asset: ${recommendation.segmentName}`,
      status: "READY",
      priority: Math.max(1, asNumber(recommendation.priority, 1)),
      requiresKevin: false,
      payload: {
        source: "MarketingRevenueDecisionService",
        decisionType: "DATA_ASSET",
        recommendationId: recommendation.id,
        segmentId: recommendation.segmentId,
        segmentName: recommendation.segmentName,
        reason: recommendation.reason,
        requiredAction:
          "Validate freshness, deduplication, schema integrity, and downstream usability."
      }
    });

    state.taskIds.add(taskId);
    summary.tasksCreated += 1;
    summary.maintenanceTasks += 1;

    this.store.insertEvent(
      "MARKETING_DATA_ASSET_TASK_CREATED",
      "Marketing Intelligence",
      {
        recommendationId: recommendation.id,
        taskId,
        segmentName: recommendation.segmentName
      }
    );
  }

  createNeedsBuildTask(
    recommendation,
    state,
    summary,
    overrideReason = null
  ) {
    const decisionKey = this.makeDecisionKey(recommendation);
    const taskId = stableId("TASK_MKT_BUILD", decisionKey);
    const reason =
      overrideReason ||
      recommendation.reason ||
      "Marketing asset requires additional build work before execution.";

    if (state.taskIds.has(taskId)) {
      summary.duplicateTasksSkipped += 1;
      summary.skippedItems += 1;
      return;
    }

    const missingCampaign = !(
      String(recommendation.campaignId || "").trim() ||
      String(recommendation.campaignName || "").trim()
    );

    this.store.addTask({
      id: taskId,
      department: "Marketing Intelligence",
      title: `Prepare segment for revenue execution: ${recommendation.segmentName}`,
      status: "READY",
      priority: asNumber(recommendation.priority, 50),
      requiresKevin: false,
      payload: {
        source: "MarketingRevenueDecisionService",
        decisionType: "NEEDS_BUILD",
        recommendationId: recommendation.id,
        segmentId: recommendation.segmentId,
        segmentName: recommendation.segmentName,
        campaignId: recommendation.campaignId,
        campaignName: recommendation.campaignName,
        missingCampaign,
        reason,
        requiredActions: missingCampaign
          ? [
              "Resolve campaign assignment",
              "Confirm verified lead inventory",
              "Confirm upload readiness",
              "Return segment to the revenue decision engine"
            ]
          : [
              "Acquire or enrich missing data",
              "Verify email inventory",
              "Confirm segment readiness",
              "Return segment to the revenue decision engine"
            ]
      }
    });

    state.taskIds.add(taskId);
    summary.tasksCreated += 1;
    summary.needsBuildTasks += 1;

    this.store.insertEvent(
      "MARKETING_NEEDS_BUILD_TASK_CREATED",
      "Marketing Intelligence",
      {
        recommendationId: recommendation.id,
        taskId,
        segmentName: recommendation.segmentName,
        reason
      }
    );
  }

  skipOperationsOnly(recommendation, summary) {
    summary.operationsSkipped += 1;
    summary.skippedItems += 1;

    this.store.insertEvent(
      "MARKETING_OPERATIONS_ONLY_SKIPPED",
      "Marketing Operations",
      {
        recommendationId: recommendation.id,
        segmentId: recommendation.segmentId,
        segmentName: recommendation.segmentName,
        reason:
          recommendation.reason ||
          "Operational dataset does not require a revenue action."
      }
    );
  }

  run(options = {}) {
    const recommendations = this.getRecommendations();

    const existingTasks = this.getExistingTasks();
    const existingQueue = this.getExistingQueue();
    const existingApprovals = this.getExistingApprovals();

    const state = {
      taskIds: new Set(existingTasks.map(item => item.id)),
      queueIds: new Set(existingQueue.map(item => item.id)),
      approvalIds: new Set(existingApprovals.map(item => item.id))
    };

    const summary = {
      service: "MarketingRevenueDecisionService",
      runDate: new Date().toISOString(),
      processed: 0,
      tasksCreated: 0,
      revenueTasksCreated: 0,
      uploadQueueItems: 0,
      approvalsCreated: 0,
      maintenanceTasks: 0,
      operationsSkipped: 0,
      needsBuildTasks: 0,
      invalidRevenueTargets: 0,
      unknownStatuses: 0,
      duplicateTasksSkipped: 0,
      duplicateQueueItemsSkipped: 0,
      duplicateApprovalsSkipped: 0,
      queuedItems: 0,
      skippedItems: 0,
      dryRun: Boolean(options.dryRun)
    };

    if (options.dryRun) {
      const classifications = recommendations.reduce((result, item) => {
        const status = normalizeStatus(item.status) || "UNKNOWN";
        result[status] = (result[status] || 0) + 1;
        return result;
      }, {});

      return {
        ...summary,
        processed: recommendations.length,
        classifications
      };
    }

    for (const recommendation of recommendations) {
      summary.processed += 1;

      const status = normalizeStatus(recommendation.status);

      switch (status) {
        case "REVENUE_TARGET":
          this.createRevenueTargetWork(recommendation, state, summary);
          break;

        case "DATA_ASSET":
          this.createDataAssetTask(recommendation, state, summary);
          break;

        case "OPERATIONS_ONLY":
          this.skipOperationsOnly(recommendation, summary);
          break;

        case "NEEDS_BUILD":
          this.createNeedsBuildTask(recommendation, state, summary);
          break;

        default:
          summary.unknownStatuses += 1;
          summary.skippedItems += 1;

          this.store.insertEvent(
            "MARKETING_RECOMMENDATION_STATUS_UNKNOWN",
            this.department,
            {
              recommendationId: recommendation.id,
              segmentId: recommendation.segmentId,
              segmentName: recommendation.segmentName,
              status: recommendation.status
            }
          );
          break;
      }
    }

    const run = this.store.createUploadQueueRun({
      queuedItems: summary.queuedItems,
      skippedItems: summary.skippedItems,
      payload: summary
    });

    summary.runId = run.id;
    summary.runRecorded = true;

    this.store.insertEvent(
      "MARKETING_REVENUE_DECISION_RUN_COMPLETED",
      this.department,
      summary
    );

    return summary;
  }
}

const service = new MarketingRevenueDecisionService();

module.exports = service;
module.exports.MarketingRevenueDecisionService =
  MarketingRevenueDecisionService;

if (require.main === module) {
  try {
    const dryRun = process.argv.includes("--dry-run");
    const result = service.run({ dryRun });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          service: "MarketingRevenueDecisionService",
          status: "FAILED",
          error: error.message,
          stack: error.stack
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
}
