"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, data) {
  ensureDir(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function readCsvCount(file) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return 0;
    return Math.max(0, text.split(/\r?\n/).length - 1);
  } catch {
    return 0;
  }
}

function scanSegments() {
  const dirs = [
    path.join(ROOT, "DATA", "segments"),
    "D:\\P2GC_Intelligence\\Good Files to use\\Good To Use and segmented",
    "D:\\P2GC_Intelligence\\SEGMENTS"
  ];

  const segments = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith(".csv")) continue;

      const full = path.join(dir, file);
      const rows = readCsvCount(full);
      const name = file.replace(/\.csv$/i, "");

      segments.push({
        name,
        file: full,
        leadCount: rows,
        verifiedEmailEstimate: /email_ready|verified|validated|million/i.test(file) ? rows : null,
        readyForUpload: /email_ready|verified|validated|million/i.test(file),
        assignedCampaign: null,
        needsEnrichment: !/email_ready|verified|validated|million/i.test(file),
        lastScanned: now()
      });
    }
  }

  return segments.sort((a, b) => b.leadCount - a.leadCount);
}

async function getInstantlyCampaigns() {
  try {
    const instantly = require("../../CONNECTORS/INSTANTLY/instantly");
    const response = await instantly.listCampaigns();
    const campaigns = response.items || [];

    return {
      ok: true,
      totalCampaigns: campaigns.length,
      activeCampaigns: campaigns.filter(c => c.status === 1).length,
      pausedCampaigns: campaigns.filter(c => c.status !== 1).length,
      campaigns: campaigns.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        dailyLimit: c.daily_limit || 0,
        created: c.timestamp_created,
        updated: c.timestamp_updated
      }))
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      totalCampaigns: 0,
      activeCampaigns: 0,
      pausedCampaigns: 0,
      campaigns: []
    };
  }
}

function buildWorkItems(campaignRegistry, segmentRegistry) {
  const work = [];

  if (!campaignRegistry.ok) {
    work.push({
      priority: 1,
      department: "Marketing",
      title: "Fix Instantly API connection",
      reason: campaignRegistry.error,
      requiresKevin: false,
      status: "READY"
    });
  }

  if (campaignRegistry.pausedCampaigns > campaignRegistry.activeCampaigns) {
    work.push({
      priority: 1,
      department: "Marketing",
      title: "Review paused Instantly campaigns",
      reason: `${campaignRegistry.pausedCampaigns} paused campaigns and ${campaignRegistry.activeCampaigns} active campaigns detected.`,
      requiresKevin: true,
      status: "AWAITING_APPROVAL"
    });
  }

  const readySegments = segmentRegistry.filter(s => s.readyForUpload && s.leadCount > 0);

  for (const seg of readySegments.slice(0, 10)) {
    work.push({
      priority: 2,
      department: "Marketing",
      title: `Prepare segment for campaign upload: ${seg.name}`,
      reason: `${seg.leadCount} campaign-ready leads detected.`,
      requiresKevin: false,
      status: "READY",
      segment: seg.name,
      file: seg.file
    });
  }

  return work;
}

async function runMarketingCOO() {
  const campaignRegistry = await getInstantlyCampaigns();
  const segmentRegistry = scanSegments();
  const workItems = buildWorkItems(campaignRegistry, segmentRegistry);

  const summary = {
    generatedAt: now(),
    department: "Marketing COO",
    status: campaignRegistry.ok ? "OPERATIONAL" : "DEGRADED",
    instantly: {
      ok: campaignRegistry.ok,
      totalCampaigns: campaignRegistry.totalCampaigns,
      activeCampaigns: campaignRegistry.activeCampaigns,
      pausedCampaigns: campaignRegistry.pausedCampaigns,
      error: campaignRegistry.error || null
    },
    segments: {
      totalSegments: segmentRegistry.length,
      readySegments: segmentRegistry.filter(s => s.readyForUpload).length,
      totalLeadsFound: segmentRegistry.reduce((n, s) => n + s.leadCount, 0)
    },
    workQueue: {
      total: workItems.length,
      ready: workItems.filter(w => w.status === "READY").length,
      awaitingApproval: workItems.filter(w => w.status === "AWAITING_APPROVAL").length
    },
    topActions: workItems.slice(0, 5)
  };

  writeJson(path.join(ROOT, "DATA", "digital_coo", "registries", "campaign_registry.json"), campaignRegistry);
  writeJson(path.join(ROOT, "DATA", "digital_coo", "registries", "segment_registry.json"), segmentRegistry);
  writeJson(path.join(ROOT, "DATA", "digital_coo", "registries", "marketing_work_queue.json"), workItems);
  writeJson(path.join(ROOT, "DATA", "digital_coo", "briefs", "marketing_executive_brief.json"), summary);

  return summary;
}

module.exports = {
  runMarketingCOO
};
