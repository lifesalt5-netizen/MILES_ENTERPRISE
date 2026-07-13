"use strict";

const store = require("../../CORE/CANONICAL/EnterpriseStore");

function rows(table) {
  return store.db.prepare(`SELECT * FROM ${table}`).all();
}

function parse(row) {
  try {
    return JSON.parse(row.payload || "{}");
  } catch {
    return {};
  }
}

function normalizeStatus(value) {
  return String(value || "").toUpperCase();
}

function buildCapacityPlan() {
  const domains = rows("domains").map(r => ({ ...r, payloadObject: parse(r) }));
  const inboxes = rows("inboxes").map(r => ({ ...r, payloadObject: parse(r) }));
  const campaigns = rows("campaigns").map(r => ({ ...r, payloadObject: parse(r) }));
  const segments = rows("segments").map(r => ({ ...r, payloadObject: parse(r) }));

  const activeInboxes = inboxes.filter(i => normalizeStatus(i.status) === "ACTIVE");
  const sendableDomains = domains.filter(d => normalizeStatus(d.status) === "ACTIVE");

  const totalCapacity = activeInboxes.reduce((n, i) => n + Number(i.dailyLimit || 0), 0);

  const domainCapacity = sendableDomains.map(domain => {
    const domainInboxes = activeInboxes.filter(i => i.domain === domain.domain);

    return {
      domain: domain.domain,
      status: domain.status,
      healthScore: domain.healthScore,
      inboxes: domainInboxes.length,
      dailyCapacity: domainInboxes.reduce((n, i) => n + Number(i.dailyLimit || 0), 0),
      inboxList: domainInboxes.map(i => ({
        email: i.email,
        dailyLimit: Number(i.dailyLimit || 0),
        status: i.status
      }))
    };
  });

  const activeCampaigns = campaigns.filter(c => String(c.status) === "1");
  const pausedCampaigns = campaigns.filter(c => String(c.status) !== "1");

  const readySegments = segments.filter(s =>
    String(s.uploadStatus || "").includes("READY") ||
    Number(s.readyForUpload || 0) === 1
  );

  const reviewSegments = segments.filter(s =>
    String(s.uploadStatus || "") === "READY_FOR_REVIEW" ||
    String(s.uploadStatus || "") === "READY_AFTER_DEDUPE_OR_CLEANUP"
  );

  const recommendedQueue = reviewSegments.slice(0, 10).map((segment, index) => {
    const preferredCampaign =
      campaigns.find(c =>
        String(segment.assignedCampaign || "").toLowerCase() === String(c.name || "").toLowerCase()
      ) ||
      activeCampaigns[0] ||
      null;

    const preferredDomain = domainCapacity[index % Math.max(1, domainCapacity.length)] || null;

    const estimatedRows =
      Number(segment.exactRows || 0) ||
      Number(segment.payloadObject.exactRows || 0) ||
      0;

    const dailyAllocation = preferredDomain
      ? Math.min(preferredDomain.dailyCapacity, estimatedRows || preferredDomain.dailyCapacity)
      : 0;

    return {
      segmentId: segment.id,
      segment: segment.name,
      status: segment.uploadStatus,
      estimatedRows,
      campaign: preferredCampaign ? preferredCampaign.name : null,
      campaignId: preferredCampaign ? preferredCampaign.id : null,
      domain: preferredDomain ? preferredDomain.domain : null,
      inboxes: preferredDomain ? preferredDomain.inboxList.map(i => i.email) : [],
      dailyAllocation,
      requiresKevin: true,
      reason: "Segment is ready for review but upload should wait for Kevin approval until upload engine is enabled."
    };
  });

  const tasks = [];

  if (pausedCampaigns.length > activeCampaigns.length) {
    tasks.push(store.addTask({
      department: "Marketing",
      title: "Approve paused campaign review",
      priority: 1,
      requiresKevin: true,
      payload: {
        activeCampaigns: activeCampaigns.length,
        pausedCampaigns: pausedCampaigns.length,
        pausedCampaignNames: pausedCampaigns.map(c => c.name)
      }
    }));
  }

  if (recommendedQueue.length > 0) {
    tasks.push(store.addTask({
      department: "Marketing",
      title: "Review outbound upload plan",
      priority: 1,
      requiresKevin: true,
      payload: {
        totalCapacity,
        recommendedUploads: recommendedQueue.length,
        queue: recommendedQueue.slice(0, 5)
      }
    }));
  }

  const result = {
    generatedAt: new Date().toISOString(),
    totalDailyCapacity: totalCapacity,
    activeInboxes: activeInboxes.length,
    sendableDomains: sendableDomains.length,
    activeCampaigns: activeCampaigns.length,
    pausedCampaigns: pausedCampaigns.length,
    readySegments: readySegments.length,
    reviewSegments: reviewSegments.length,
    domainCapacity,
    recommendedQueue,
    tasksCreated: tasks.length,
    storeStats: store.stats()
  };

  store.insertEvent("MARKETING_CAPACITY_PLAN_BUILT", "Marketing", result);

  return result;
}

module.exports = {
  buildCapacityPlan
};
