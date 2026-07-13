"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");
const InstantlyCOOService =
  require("../../SERVICES/digital_coo/InstantlyCOOService");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "marketing_coo");

const INVENTORY_FILES = Object.freeze({
  campaignStatus: path.join(
    ROOT,
    "DATA",
    "OUTBOUND",
    "CAMPAIGN_STATUS_MASTER.csv"
  ),
  domainStatus: path.join(
    ROOT,
    "DATA",
    "OUTBOUND",
    "DOMAIN_STATUS_MASTER.csv"
  ),
  segmentInventory: path.join(
    ROOT,
    "DATA",
    "OUTBOUND",
    "SEGMENT_INVENTORY_MASTER.csv"
  ),
  leadUploadQueue: path.join(
    ROOT,
    "runtime",
    "instantly_coo",
    "lead_upload_queue.json"
  )
});

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });

    return record;
  });
}

function firstValue(record, names, fallback = "") {
  for (const name of names) {
    if (
      Object.prototype.hasOwnProperty.call(record, name) &&
      record[name] !== ""
    ) {
      return record[name];
    }
  }

  return fallback;
}

function numberValue(record, names, fallback = 0) {
  const raw = firstValue(record, names, null);
  const value = Number(raw);

  return Number.isFinite(value) ? value : fallback;
}

function booleanValue(record, names) {
  const value = String(firstValue(record, names, ""))
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "y", "ready", "active"].includes(value);
}

function persistEvidence(result) {
  ensureDir();

  const stamp = Date.now();
  const historical = path.join(
    OUT_DIR,
    `marketing_operation_${stamp}.json`
  );

  const latest = path.join(
    OUT_DIR,
    "latest_marketing_operation.json"
  );

  const text = JSON.stringify(result, null, 2);

  fs.writeFileSync(historical, text, "utf8");
  fs.writeFileSync(latest, text, "utf8");

  return historical;
}

function summarizeCampaignInventory(rows) {
  const active = rows.filter(row => {
    const status = String(
      firstValue(row, [
        "Status",
        "status",
        "Campaign_Status",
        "campaign_status"
      ])
    ).toLowerCase();

    return status.includes("active") || status === "1";
  });

  const paused = rows.filter(row => {
    const status = String(
      firstValue(row, [
        "Status",
        "status",
        "Campaign_Status",
        "campaign_status"
      ])
    ).toLowerCase();

    return status.includes("pause") || status === "0";
  });

  return {
    total: rows.length,
    active: active.length,
    paused: paused.length
  };
}

function summarizeDomainInventory(rows) {
  const healthy = rows.filter(row => {
    const health = String(
      firstValue(row, [
        "Health",
        "health",
        "Status",
        "status",
        "Domain_Status",
        "domain_status"
      ])
    ).toLowerCase();

    return (
      health.includes("healthy") ||
      health.includes("ready") ||
      health.includes("active")
    );
  });

  const protectedRows = rows.filter(row => {
    const domain = String(
      firstValue(row, [
        "Domain",
        "domain",
        "Email_Domain",
        "email_domain"
      ])
    ).toLowerCase();

    return (
      domain === "pathways2gc.com" ||
      booleanValue(row, [
        "Protected",
        "protected",
        "Website_Only",
        "website_only"
      ])
    );
  });

  return {
    total: rows.length,
    healthy: healthy.length,
    protected: protectedRows.length
  };
}

function summarizeSegments(rows) {
  const normalized = rows.map(row => ({
    name: firstValue(row, [
      "Segment_Name",
      "segment_name",
      "Segment",
      "segment",
      "Primary_Segment",
      "primary_segment"
    ], "Unknown"),
    leadCount: numberValue(row, [
      "Lead_Count",
      "lead_count",
      "Total_Leads",
      "total_leads",
      "Rows",
      "rows"
    ]),
    verifiedEmailCount: numberValue(row, [
      "Verified_Email_Count",
      "verified_email_count",
      "Verified_Emails",
      "verified_emails",
      "Email_Ready_Count",
      "email_ready_count"
    ]),
    needsEnrichment: booleanValue(row, [
      "Needs_Enrichment",
      "needs_enrichment"
    ]),
    needsUpload: booleanValue(row, [
      "Needs_Upload",
      "needs_upload"
    ]),
    campaignStatus: firstValue(row, [
      "Campaign_Status",
      "campaign_status",
      "Status",
      "status"
    ], "Unknown")
  }));

  const totalLeads = normalized.reduce(
    (sum, row) => sum + row.leadCount,
    0
  );

  const verifiedEmails = normalized.reduce(
    (sum, row) => sum + row.verifiedEmailCount,
    0
  );

  const uploadReady = normalized.filter(row =>
    row.verifiedEmailCount > 0 &&
    !row.needsEnrichment &&
    (
      row.needsUpload ||
      /ready|not loaded|pending/i.test(row.campaignStatus)
    )
  );

  const depleted = normalized.filter(row =>
    row.leadCount === 0 ||
    (
      row.leadCount > 0 &&
      row.verifiedEmailCount === 0
    )
  );

  return {
    totalSegments: normalized.length,
    totalLeads,
    verifiedEmails,
    uploadReadySegments: uploadReady.length,
    depletedSegments: depleted.length,
    uploadReady,
    depleted,
    segments: normalized
  };
}

class MarketingProvider extends IDataProvider {
  constructor(options = {}) {
    super("Marketing");

    this.dependencies = [
      "Instantly",
      "Website",
      "LinkedIn",
      "MillionVerifier"
    ];

    this.sourceSystems = [
      "SERVICES/digital_coo/InstantlyCOOService.js",
      "DATA/OUTBOUND/CAMPAIGN_STATUS_MASTER.csv",
      "DATA/OUTBOUND/DOMAIN_STATUS_MASTER.csv",
      "DATA/OUTBOUND/SEGMENT_INVENTORY_MASTER.csv"
    ];

    this.instantlyCOO =
      options.instantlyCOO ||
      new InstantlyCOOService({
        rootDir: ROOT
      });
  }

  async initialize() {
    return this.refresh();
  }

  async refresh() {
    return this.auditMarketingOperations();
  }

  async auditCampaignHealth() {
    return this.auditMarketingOperations();
  }

  async auditDeliverability() {
    return this.auditMarketingOperations();
  }

  async auditCapacity() {
    return this.auditMarketingOperations();
  }

  async auditSegments() {
    return this.auditMarketingOperations();
  }

  async auditMarketingOperations() {
    this.lastRefresh = new Date().toISOString();
    this.dataFreshness = "Live";

    const campaignRows = readCsv(
      INVENTORY_FILES.campaignStatus
    );

    const domainRows = readCsv(
      INVENTORY_FILES.domainStatus
    );

    const segmentRows = readCsv(
      INVENTORY_FILES.segmentInventory
    );

    const uploadQueue = safeReadJson(
      INVENTORY_FILES.leadUploadQueue,
      []
    );

    let instantlySnapshot;

    try {
      instantlySnapshot =
        await this.instantlyCOO.generateSnapshot();
    } catch (error) {
      instantlySnapshot = {
        ok: false,
        status: "DEGRADED",
        summary: {
          totalAccounts: 0,
          campaignSafeAccounts: 0,
          protectedAccounts: 0,
          healthyAccounts: 0,
          warningAccounts: 0,
          criticalAccounts: 0,
          totalCampaigns: 0,
          healthyCampaigns: 0,
          warningCampaigns: 0,
          criticalCampaigns: 0,
          totalDailyCapacity: 0,
          averageWarmupScore: null,
          lowestWarmupScore: null
        },
        accounts: [],
        campaigns: [],
        recommendations: [],
        errors: [{
          area: "INSTANTLY",
          error: error.message
        }]
      };
    }

    const campaignInventory =
      summarizeCampaignInventory(campaignRows);

    const domainInventory =
      summarizeDomainInventory(domainRows);

    const segmentInventory =
      summarizeSegments(segmentRows);

    const queueItems = Array.isArray(uploadQueue)
      ? uploadQueue
      : (
          Array.isArray(uploadQueue?.items)
            ? uploadQueue.items
            : Array.isArray(uploadQueue?.queue)
              ? uploadQueue.queue
              : []
        );

    const summary = instantlySnapshot.summary || {};

    const criticalAccounts =
      Number(summary.criticalAccounts || 0);

    const criticalCampaigns =
      Number(summary.criticalCampaigns || 0);

    const warningAccounts =
      Number(summary.warningAccounts || 0);

    const warningCampaigns =
      Number(summary.warningCampaigns || 0);

    const protectedViolations =
      (instantlySnapshot.campaigns || [])
        .filter(campaign =>
          Array.isArray(campaign.protectedAssignments) &&
          campaign.protectedAssignments.length > 0
        );

    this.status =
      criticalAccounts > 0 ||
      criticalCampaigns > 0 ||
      protectedViolations.length > 0
        ? "Critical"
        : (
            warningAccounts > 0 ||
            warningCampaigns > 0 ||
            instantlySnapshot.ok === false
              ? "Watch"
              : "Healthy"
          );

    this.metrics = {
      totalCampaigns:
        Number(summary.totalCampaigns || 0),
      healthyCampaigns:
        Number(summary.healthyCampaigns || 0),
      warningCampaigns,
      criticalCampaigns,
      totalAccounts:
        Number(summary.totalAccounts || 0),
      campaignSafeAccounts:
        Number(summary.campaignSafeAccounts || 0),
      protectedAccounts:
        Number(summary.protectedAccounts || 0),
      warningAccounts,
      criticalAccounts,
      totalDailyCapacity:
        Number(summary.totalDailyCapacity || 0),
      averageWarmupScore:
        summary.averageWarmupScore ?? null,
      lowestWarmupScore:
        summary.lowestWarmupScore ?? null,
      protectedAssignmentViolations:
        protectedViolations.length,
      campaignInventory,
      domainInventory,
      segmentInventory: {
        totalSegments:
          segmentInventory.totalSegments,
        totalLeads:
          segmentInventory.totalLeads,
        verifiedEmails:
          segmentInventory.verifiedEmails,
        uploadReadySegments:
          segmentInventory.uploadReadySegments,
        depletedSegments:
          segmentInventory.depletedSegments
      },
      queuedLeadUploads:
        queueItems.length
    };

    this.exceptions = [
      ...(instantlySnapshot.errors || [])
        .map(item => ({
          type: "InstantlyAudit",
          severity: "Warning",
          message:
            `${item.area}: ${item.error}`
        })),
      ...protectedViolations.map(campaign => ({
        type: "ProtectedAccountAssignment",
        severity: "Critical",
        message:
          `Protected account assigned to campaign ${campaign.name || campaign.id}.`
      })),
      ...segmentInventory.depleted
        .slice(0, 25)
        .map(segment => ({
          type: "SegmentDepleted",
          severity: "Info",
          message:
            `Segment ${segment.name} has no campaign-ready verified email inventory.`
        }))
    ];

    this.recommendations = [
      ...(instantlySnapshot.recommendations || []),
      ...segmentInventory.uploadReady
        .slice(0, 25)
        .map(segment =>
          `Queue verified lead upload for segment ${segment.name} (${segment.verifiedEmailCount} verified emails).`
        ),
      ...segmentInventory.depleted
        .slice(0, 25)
        .map(segment =>
          `Enrich or replenish segment ${segment.name}.`
        )
    ];

    const result = {
      ok:
        this.status !== "Critical" ||
        instantlySnapshot.ok === true,
      provider: "MarketingProvider",
      action: "auditMarketingOperations",
      status: this.status,
      generatedAt: this.lastRefresh,
      readOnly: true,
      metrics: this.metrics,
      exceptions: this.exceptions,
      recommendations: this.recommendations,
      instantly: instantlySnapshot,
      inventories: {
        campaigns: campaignInventory,
        domains: domainInventory,
        segments: segmentInventory,
        leadUploadQueue: queueItems
      },
      safety: {
        protectedWebsiteDomain:
          "pathways2gc.com",
        protectedAdminInbox:
          "info@pathways2gc.com",
        writesEnabled: false,
        automaticPauseResume: false,
        automaticLeadUpload: false
      }
    };

    result.evidenceFile =
      persistEvidence(result);

    return result;
  }

  getCampaignByName(name) {
    const campaigns =
      this.metrics?.campaigns || [];

    return campaigns.find(
      campaign => campaign.name === name
    ) || null;
  }

  getActiveCampaigns() {
    const campaigns =
      this.metrics?.campaigns || [];

    return campaigns.filter(
      campaign =>
        campaign.status === 1 ||
        String(campaign.status)
          .toLowerCase() === "active"
    );
  }

  async executeTask(task = {}) {
    const action =
      task.payload?.action ||
      task.action ||
      "auditMarketingOperations";

    if (typeof this[action] !== "function") {
      throw new Error(
        `Unsupported MarketingProvider action: ${action}`
      );
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports = MarketingProvider;

