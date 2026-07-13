"use strict";

const store = require("../../CORE/CANONICAL/EnterpriseStore");

function normalize(text) {
  return String(text || "").toLowerCase();
}

function parsePayload(row) {
  try {
    return JSON.parse(row.payload || "{}");
  } catch {
    return {};
  }
}

function getRows(table) {
  if (store.mode !== "sqlite") {
    return store.json?.[table] || [];
  }

  return store.db.prepare(`SELECT * FROM ${table}`).all();
}

function matchCampaign(segment, campaigns) {
  const s = normalize(segment.name);

  return campaigns.find(c => {
    const name = normalize(c.name);

    return (
      (s.includes("sbs") && name.includes("sbs")) ||
      (s.includes("gsa") && name.includes("gsa")) ||
      (s.includes("sam") && name.includes("sam")) ||
      (s.includes("va") && name.includes("va")) ||
      (s.includes("hubzone") && name.includes("hubzone")) ||
      (s.includes("expired") && name.includes("expired")) ||
      name.includes(s.slice(0, 12))
    );
  }) || null;
}

function updateSegmentAssignment(segmentId, campaign) {
  if (store.mode !== "sqlite") return;

  store.db.prepare(`
    UPDATE segments
    SET assignedCampaign = ?,
        uploadStatus = ?,
        nextAction = ?,
        updatedAt = ?
    WHERE id = ?
  `).run(
    campaign ? campaign.name : null,
    campaign ? "CAMPAIGN_ASSIGNED" : "NEEDS_CAMPAIGN_ASSIGNMENT",
    campaign ? "Prepare campaign upload after verification approval" : "Assign campaign",
    new Date().toISOString(),
    segmentId
  );
}

function runAssignmentEngine() {
  const segments = getRows("segments").map(r => ({
    ...r,
    payloadObject: parsePayload(r)
  }));

  const campaigns = getRows("campaigns").map(r => ({
    ...r,
    payloadObject: parsePayload(r)
  }));

  const assignments = [];
  const tasks = [];

  for (const segment of segments) {
    const campaign = matchCampaign(segment, campaigns);

    if (campaign) {
      updateSegmentAssignment(segment.id, campaign);

      assignments.push({
        segment: segment.name,
        campaign: campaign.name,
        readyForUpload: Boolean(segment.readyForUpload),
        verified: Boolean(segment.verified),
        action: segment.readyForUpload
          ? "PREPARE_UPLOAD"
          : "VERIFY_BEFORE_UPLOAD"
      });
    }

    if (!segment.verified || !segment.readyForUpload) {
      tasks.push(store.addTask({
        department: "Marketing",
        title: `Verify email readiness: ${segment.name}`,
        priority: 2,
        requiresKevin: false,
        payload: {
          segmentId: segment.id,
          segment: segment.name,
          file: segment.file,
          exactRows: segment.exactRows,
          assignedCampaign: campaign ? campaign.name : null,
          reason: "Segment has email column but is not yet confirmed as verified/EMAIL_READY."
        }
      }));
    }
  }

  const activeCampaigns = campaigns.filter(c => String(c.status) === "1");
  const pausedCampaigns = campaigns.filter(c => String(c.status) !== "1");

  if (pausedCampaigns.length > activeCampaigns.length) {
    tasks.push(store.addTask({
      department: "Marketing",
      title: "Review paused Instantly campaigns",
      priority: 1,
      requiresKevin: true,
      payload: {
        activeCampaigns: activeCampaigns.length,
        pausedCampaigns: pausedCampaigns.length,
        pausedCampaignNames: pausedCampaigns.map(c => c.name)
      }
    }));
  }

  store.insertEvent("MARKETING_ASSIGNMENT_ENGINE_RUN", "Marketing", {
    segments: segments.length,
    campaigns: campaigns.length,
    assignments: assignments.length,
    tasksCreated: tasks.length
  });

  return {
    generatedAt: new Date().toISOString(),
    segments: segments.length,
    campaigns: campaigns.length,
    assignments: assignments.length,
    activeCampaigns: activeCampaigns.length,
    pausedCampaigns: pausedCampaigns.length,
    tasksCreated: tasks.length,
    topAssignments: assignments.slice(0, 15),
    storeStats: store.stats()
  };
}

module.exports = {
  runAssignmentEngine
};
