
"use strict";

const store = require("../../CORE/CANONICAL/EnterpriseStore");

class MarketingUploadQueueEngine {
  constructor() {
    this.store = store;
  }

  normalize(value) {
    return String(value || "").trim();
  }

  upper(value) {
    return this.normalize(value).toUpperCase();
  }

  number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  payload(row) {
    if (!row) return {};
    return row.payload && typeof row.payload === "object" ? row.payload : {};
  }

  getSegmentEmailCount(segment) {
    const payload = this.payload(segment);

    return this.number(
      segment.exactRows ||
      payload.verified_email_count ||
      payload.email_ready_count ||
      payload.email_count ||
      payload.lead_count ||
      payload.rows ||
      0
    );
  }

  isSegmentReady(segment) {
    const payload = this.payload(segment);

    const status = this.upper(
      segment.uploadStatus ||
      payload.marketing_status ||
      payload.intelligence_status ||
      payload.status ||
      payload.analysis_status
    );

    return (
      segment.readyForUpload === 1 ||
      segment.readyForUpload === true ||
      status === "READY" ||
      status === "READY_FOR_REVIEW" ||
      status === "READY_AFTER_DEDUPE_OR_CLEANUP"
    );
  }

  getCampaignDomain(campaign) {
    const payload = this.payload(campaign);

    return (
      payload.domain ||
      payload.sending_domain ||
      payload.primary_domain ||
      payload.sendingDomain ||
      null
    );
  }

  getFallbackAllocations() {
    const campaigns = this.store.getCampaigns();
    const activeCampaigns = this.store.getActiveCampaigns();
    const usableCampaigns = activeCampaigns.length > 0 ? activeCampaigns : campaigns;
    const usableInboxes = this.store.getUsableInboxes();

    const totalDailyCapacity = usableInboxes.reduce((sum, inbox) => {
      return sum + this.number(inbox.dailyLimit || this.payload(inbox).dailyLimit || 0);
    }, 0);

    const usableDailyCapacity = Math.max(0, Math.floor(totalDailyCapacity * 0.85));
    const perCampaign = usableCampaigns.length > 0
      ? Math.max(1, Math.floor(usableDailyCapacity / usableCampaigns.length))
      : 0;

    return usableCampaigns.map((campaign) => {
      const domain = this.getCampaignDomain(campaign);

      return {
        planId: null,
        campaignId: campaign.id,
        campaignName: campaign.name,
        domain,
        recommendedUploadCount: perCampaign * 5,
        status: campaign.status || "UNKNOWN"
      };
    });
  }

  getAllocations() {
    const plan = this.store.getLatestCapacityPlan();

    if (!plan) {
      return {
        plan,
        allocations: this.getFallbackAllocations()
      };
    }

    const allocations = this.store.getCapacityAllocations(plan.id).map((allocation) => ({
      planId: allocation.planId,
      campaignId: allocation.campaignId,
      campaignName: allocation.campaignName,
      domain: allocation.domain,
      recommendedUploadCount: allocation.recommendedUploadCount,
      status: allocation.status
    }));

    return { plan, allocations };
  }

  alreadyQueued(segmentId, campaignId) {
    const activeStatuses = new Set([
      "PENDING_APPROVAL",
      "APPROVED",
      "READY_FOR_UPLOAD",
      "UPLOADING"
    ]);

    return this.store.getUploadQueue().some((item) => {
      return (
        String(item.segmentId) === String(segmentId) &&
        String(item.campaignId) === String(campaignId) &&
        activeStatuses.has(this.upper(item.status))
      );
    });
  }

  createApproval(queueId, segment, allocation, requestedUploadCount) {
    return this.store.createApproval({
      department: "Marketing",
      title: `Approve upload: ${segment.name}`,
      status: "PENDING",
      payload: {
        type: "MARKETING_UPLOAD",
        queueId,
        segmentId: segment.id,
        segmentName: segment.name,
        campaignId: allocation.campaignId,
        campaignName: allocation.campaignName,
        domain: allocation.domain || null,
        requestedUploadCount
      }
    });
  }

  run() {
    const { plan, allocations } = this.getAllocations();

    const readySegments = this.store
      .getSegments()
      .filter((segment) => this.isSegmentReady(segment))
      .filter((segment) => this.getSegmentEmailCount(segment) > 0);

    let queuedItems = 0;
    let skippedItems = 0;

    for (const allocation of allocations) {
      if (!allocation.campaignId) {
        skippedItems++;
        continue;
      }

      const recommendedUploadCount = this.number(allocation.recommendedUploadCount, 0);

      if (recommendedUploadCount <= 0) {
        skippedItems++;
        continue;
      }

      const segment = readySegments.find((candidate) => {
        return !this.alreadyQueued(candidate.id, allocation.campaignId);
      });

      if (!segment) {
        skippedItems++;
        continue;
      }

      const requestedUploadCount = Math.min(
        this.getSegmentEmailCount(segment),
        recommendedUploadCount
      );

      const queueId = this.store.id("UPLOAD");
      const approval = this.createApproval(
        queueId,
        segment,
        allocation,
        requestedUploadCount
      );

      this.store.createUploadQueueItem({
        id: queueId,
        segmentId: segment.id,
        segmentName: segment.name,
        campaignId: allocation.campaignId,
        campaignName: allocation.campaignName,
        domain: allocation.domain || null,
        requestedUploadCount,
        approvedUploadCount: 0,
        status: "PENDING_APPROVAL",
        priority: 50,
        requiresKevin: 1,
        approvalId: approval.id,
        reason: "Kevin approval required before Instantly upload.",
        payload: {
          source: "MarketingUploadQueueEngine",
          capacityPlanId: plan ? plan.id : null,
          allocation,
          segmentPayload: this.payload(segment)
        }
      });

      queuedItems++;
    }

    const run = this.store.createUploadQueueRun({
      queuedItems,
      skippedItems,
      payload: {
        source: "MarketingUploadQueueEngine",
        capacityPlanId: plan ? plan.id : null,
        allocationsSeen: allocations.length,
        readySegmentsSeen: readySegments.length
      }
    });

    this.store.insertEvent("MARKETING_UPLOAD_QUEUE_CREATED", "Marketing", {
      runId: run.id,
      queuedItems,
      skippedItems,
      capacityPlanId: plan ? plan.id : null
    });

    return {
      runId: run.id,
      capacityPlanId: plan ? plan.id : null,
      queuedItems,
      skippedItems,
      pendingApprovals: this.store.getPendingApprovals("Marketing").length,
      uploadQueueTotal: this.store.getUploadQueue().length
    };
  }
}

module.exports = MarketingUploadQueueEngine;
