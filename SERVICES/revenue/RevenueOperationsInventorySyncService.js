"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

class RevenueOperationsInventorySyncService {
  constructor(options = {}) {
    this.service = "REVENUE_OPERATIONS_INVENTORY_SYNC";
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.segmentProvider = options.segmentProvider || (() => this.loadCanonicalSegments());
    this.campaignProvider = options.campaignProvider || (() => this.loadLiveCampaigns());
    this.segmentInventoryPath = options.segmentInventoryPath || path.join(
      this.rootDir, "runtime", "instantly_coo", "segment_inventory.json"
    );
    this.campaignRegistryPath = options.campaignRegistryPath || path.join(
      this.rootDir, "runtime", "instantly_coo", "campaign_registry.json"
    );
    this.reportPath = options.reportPath || path.join(
      this.rootDir, "DATA", "runtime", "revenue", "revenue_inventory_sync.json"
    );
  }

  async loadCanonicalSegments() {
    const imported = require(path.join(this.rootDir, "SERVICES", "SegmentInventoryService.js"));
    const inventoryService = typeof imported === "function" ? new imported() : imported;
    if (!inventoryService || typeof inventoryService.getInventory !== "function") {
      throw new Error("SegmentInventoryService does not expose getInventory().");
    }
    return inventoryService.getInventory();
  }

  async loadLiveCampaigns() {
    const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
    const campaigns = [];
    let startingAfter = null;
    for (let page = 0; page < 100; page += 1) {
      const response = await instantly.listCampaigns({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });
      campaigns.push(...this.extractCampaigns(response));
      startingAfter = response?.next_starting_after || response?.nextStartingAfter || null;
      if (!startingAfter) break;
    }
    return campaigns;
  }

  extractCampaigns(response) {
    if (Array.isArray(response)) return response;
    for (const key of ["items", "campaigns", "data", "results"]) {
      if (Array.isArray(response?.[key])) return response[key];
    }
    throw new Error("Instantly campaign response does not contain an array.");
  }

  normalizeCampaign(campaign = {}, index = 0) {
    return {
      campaignId: campaign.id || campaign.campaignId || campaign.uuid || `campaign_${index + 1}`,
      name: campaign.name || campaign.title || `Campaign ${index + 1}`,
      status: campaign.status || campaign.state || "UNKNOWN",
      segment: campaign.segment || campaign.segmentName || campaign.listName || null,
      dailyLimit: Number(campaign.daily_limit || campaign.dailyLimit || campaign.limit || 0),
      metadata: campaign,
      syncedAt: this.generatedAt()
    };
  }

  normalizeSegment(segment = {}, index = 0, campaigns = []) {
    const campaignName = segment.campaignName || segment.campaign || null;
    const assignedCampaignId = segment.assignedCampaignId || segment.campaignId || null;
    const match = campaigns.find(campaign =>
      (assignedCampaignId && String(campaign.campaignId) === String(assignedCampaignId)) ||
      (campaignName && normalizeText(campaign.name) === normalizeText(campaignName))
    ) || null;
    const blockers = Array.isArray(segment.blockers) ? [...segment.blockers] : [];
    if (campaignName && !match) blockers.push("LIVE_CAMPAIGN_NOT_FOUND");
    const record = {
      segmentId: segment.segmentId || segment.id || segment.segmentName || segment.name || `segment_${index + 1}`,
      segmentName: segment.segmentName || segment.name || `Segment ${index + 1}`,
      leadCount: Number(segment.leadCount || segment.companyCount || segment.totalLeads || 0),
      verifiedEmailCount: Number(segment.verifiedEmailCount || segment.verifiedEmails || 0),
      campaignName,
      campaignStatus: match?.status || segment.campaignStatus || segment.status || "UNKNOWN",
      liveCampaignId: match?.campaignId || null,
      liveCampaignMatched: Boolean(match),
      assignedDomain: segment.assignedDomain || null,
      assignedInboxes: Array.isArray(segment.assignedInboxes) ? segment.assignedInboxes : [],
      sourceFile: segment.sourceFile || null,
      needsEnrichment: Boolean(segment.needsEnrichment),
      needsUpload: Boolean(segment.needsUpload),
      uploadReady: Boolean(segment.uploadReady),
      campaignReady: Boolean(segment.campaignReady && (!campaignName || match)),
      priority: Number(segment.priority || index + 1),
      blockers: [...new Set(blockers)].sort(),
      metadata: segment,
      syncedAt: this.generatedAt()
    };
    return record;
  }

  writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
    return {
      filePath,
      bytes: fs.statSync(filePath).size,
      sha256: sha256(fs.readFileSync(filePath))
    };
  }

  plan(input = {}) {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      liveCampaignReadRequested: input.live === true,
      intendedWrites: [this.segmentInventoryPath, this.campaignRegistryPath, this.reportPath],
      externalMutationsAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsLaunched: false,
      campaignsChanged: false
    };
  }

  async sync(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) {
      return {
        ...this.plan(input),
        mode: "APPLY",
        ok: false,
        status: "LIVE_READ_REQUIRED",
        blockers: ["EXPLICIT_LIVE_READ_REQUIRED"]
      };
    }

    const canonical = await this.segmentProvider();
    if (canonical?.ok !== true || !Array.isArray(canonical.segments) || canonical.segments.length === 0) {
      throw new Error("Canonical segment inventory is unavailable or empty.");
    }
    const campaignResponse = await this.campaignProvider();
    const campaigns = this.extractCampaigns(campaignResponse)
      .map((campaign, index) => this.normalizeCampaign(campaign, index));
    const segments = canonical.segments
      .map((segment, index) => this.normalizeSegment(segment, index, campaigns));
    const summary = {
      canonicalSegments: segments.length,
      liveCampaigns: campaigns.length,
      verifiedEmails: segments.reduce((sum, item) => sum + item.verifiedEmailCount, 0),
      uploadReadySegments: segments.filter(item => item.uploadReady).length,
      campaignReadySegments: segments.filter(item => item.campaignReady).length,
      liveCampaignMatches: segments.filter(item => item.liveCampaignMatched).length,
      segmentsWithBlockers: segments.filter(item => item.blockers.length > 0).length
    };
    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "SYNCHRONIZED",
      generatedAt: this.generatedAt(),
      summary,
      segments,
      campaigns,
      nextGateBlockers: segments
        .filter(item => item.blockers.length > 0)
        .map(item => ({ segmentId: item.segmentId, segmentName: item.segmentName, blockers: item.blockers })),
      externalMutationsAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsLaunched: false,
      campaignsChanged: false
    };
    const identity = { ...report };
    delete identity.generatedAt;
    report.syncFingerprint = sha256(Buffer.from(JSON.stringify(identity), "utf8"));
    const segmentArtifact = this.writeJsonAtomic(this.segmentInventoryPath, segments);
    const campaignArtifact = this.writeJsonAtomic(this.campaignRegistryPath, campaigns);
    const reportArtifact = this.writeJsonAtomic(this.reportPath, report);
    report.artifacts = { segmentInventory: segmentArtifact, campaignRegistry: campaignArtifact, report: reportArtifact };
    return report;
  }
}

module.exports = RevenueOperationsInventorySyncService;
module.exports.RevenueOperationsInventorySyncService = RevenueOperationsInventorySyncService;
