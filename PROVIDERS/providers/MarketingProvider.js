"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");
const InstantlyCOOService =
  require("../../SERVICES/digital_coo/InstantlyCOOService");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "marketing_coo");
const OPS_DIR = path.join(ROOT, "runtime", "marketing_operations");
const OPS_QUEUE_FILE = path.join(OPS_DIR, "operations_queue.json");
const OPS_LATEST_FILE = path.join(OPS_DIR, "latest_operation.json");

const PROTECTED_ASSETS = Object.freeze({
  domains: ["pathways2gc.com"],
  inboxes: [
    "info@pathways2gc.com",
    "kevin@pathways2gc.com"
  ]
});

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
  fs.mkdirSync(OUT_DIR, {
    recursive: true
  });
}

function ensureOpsDir() {
  fs.mkdirSync(OPS_DIR, {
    recursive: true
  });
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(filePath, "utf8")
    );
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true
    }
  );

  const temporaryPath =
    `${filePath}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  fs.renameSync(
    temporaryPath,
    filePath
  );

  return filePath;
}

function operationId(prefix = "MARKETING") {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);

  const random = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();

  return `${prefix}_${stamp}_${random}`;
}

function normalizeAction(value) {
  return String(value || "")
    .trim()
    .replace(/[\s.-]+/g, "_")
    .toLowerCase();
}

function getTaskPayload(task = {}) {
  if (
    task &&
    typeof task.payload === "object" &&
    task.payload
  ) {
    return task.payload;
  }

  return task;
}

function uniqueBy(items, selector) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = selector(item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (
    let index = 0;
    index < line.length;
    index += 1
  ) {
    const char = line[index];

    if (char === '"') {
      if (
        quoted &&
        line[index + 1] === '"'
      ) {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (
      char === "," &&
      !quoted
    ) {
      values.push(
        current.trim()
      );

      current = "";
      continue;
    }

    current += char;
  }

  values.push(
    current.trim()
  );

  return values;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(
      line =>
        line.trim().length > 0
    );

  if (lines.length < 2) {
    return [];
  }

  const headers =
    parseCsvLine(lines[0]);

  return lines
    .slice(1)
    .map(line => {
      const values =
        parseCsvLine(line);

      const record = {};

      headers.forEach(
        (header, index) => {
          record[header] =
            values[index] ?? "";
        }
      );

      return record;
    });
}

function firstValue(
  record,
  names,
  fallback = ""
) {
  for (const name of names) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(record, name) &&
      record[name] !== ""
    ) {
      return record[name];
    }
  }

  return fallback;
}

function numberValue(
  record,
  names,
  fallback = 0
) {
  const raw =
    firstValue(
      record,
      names,
      null
    );

  const value =
    Number(raw);

  return Number.isFinite(value)
    ? value
    : fallback;
}

function booleanValue(
  record,
  names
) {
  const value = String(
    firstValue(
      record,
      names,
      ""
    )
  )
    .trim()
    .toLowerCase();

  return [
    "1",
    "true",
    "yes",
    "y",
    "ready",
    "active"
  ].includes(value);
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

  const text =
    JSON.stringify(
      result,
      null,
      2
    );

  fs.writeFileSync(
    historical,
    text,
    "utf8"
  );

  fs.writeFileSync(
    latest,
    text,
    "utf8"
  );

  return historical;
}

function summarizeCampaignInventory(rows) {
  const active = rows.filter(row => {
    const status = String(
      firstValue(
        row,
        [
          "Status",
          "status",
          "Campaign_Status",
          "campaign_status"
        ]
      )
    ).toLowerCase();

    return (
      status.includes("active") ||
      status === "1"
    );
  });

  const paused = rows.filter(row => {
    const status = String(
      firstValue(
        row,
        [
          "Status",
          "status",
          "Campaign_Status",
          "campaign_status"
        ]
      )
    ).toLowerCase();

    return (
      status.includes("pause") ||
      status === "0"
    );
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
      firstValue(
        row,
        [
          "Health",
          "health",
          "Status",
          "status",
          "Domain_Status",
          "domain_status"
        ]
      )
    ).toLowerCase();

    return (
      health.includes("healthy") ||
      health.includes("ready") ||
      health.includes("active")
    );
  });

  const protectedRows =
    rows.filter(row => {
      const domain = String(
        firstValue(
          row,
          [
            "Domain",
            "domain",
            "Email_Domain",
            "email_domain"
          ]
        )
      ).toLowerCase();

      return (
        domain ===
          "pathways2gc.com" ||
        booleanValue(
          row,
          [
            "Protected",
            "protected",
            "Website_Only",
            "website_only"
          ]
        )
      );
    });

  return {
    total: rows.length,
    healthy: healthy.length,
    protected:
      protectedRows.length
  };
}

function summarizeSegments(rows) {
  const normalized =
    rows.map(row => ({
      name: firstValue(
        row,
        [
          "Segment_Name",
          "segment_name",
          "Segment",
          "segment",
          "Primary_Segment",
          "primary_segment"
        ],
        "Unknown"
      ),

      leadCount: numberValue(
        row,
        [
          "Lead_Count",
          "lead_count",
          "Total_Leads",
          "total_leads",
          "Rows",
          "rows"
        ]
      ),

      verifiedEmailCount:
        numberValue(
          row,
          [
            "Verified_Email_Count",
            "verified_email_count",
            "Verified_Emails",
            "verified_emails",
            "Email_Ready_Count",
            "email_ready_count"
          ]
        ),

      needsEnrichment:
        booleanValue(
          row,
          [
            "Needs_Enrichment",
            "needs_enrichment"
          ]
        ),

      needsUpload:
        booleanValue(
          row,
          [
            "Needs_Upload",
            "needs_upload"
          ]
        ),

      campaignStatus:
        firstValue(
          row,
          [
            "Campaign_Status",
            "campaign_status",
            "Status",
            "status"
          ],
          "Unknown"
        )
    }));

  const totalLeads =
    normalized.reduce(
      (sum, row) =>
        sum + row.leadCount,
      0
    );

  const verifiedEmails =
    normalized.reduce(
      (sum, row) =>
        sum +
        row.verifiedEmailCount,
      0
    );

  const uploadReady =
    normalized.filter(row =>
      row.verifiedEmailCount > 0 &&
      !row.needsEnrichment &&
      (
        row.needsUpload ||
        /ready|not loaded|pending/i
          .test(row.campaignStatus)
      )
    );

  const depleted =
    normalized.filter(row =>
      row.leadCount === 0 ||
      (
        row.leadCount > 0 &&
        row.verifiedEmailCount === 0
      )
    );

  return {
    totalSegments:
      normalized.length,

    totalLeads,

    verifiedEmails,

    uploadReadySegments:
      uploadReady.length,

    depletedSegments:
      depleted.length,

    uploadReady,

    depleted,

    segments: normalized
  };
}

class MarketingProvider
  extends IDataProvider {
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

    this.operationExecutor =
      typeof options.operationExecutor ===
      "function"
        ? options.operationExecutor
        : null;

    this.writesEnabled =
      String(
        options.writesEnabled ??
        process.env
          .MILES_MARKETING_WRITES_ENABLED ??
        "false"
      ).toLowerCase() === "true";

    this.lastAudit = null;
  }

  async initialize() {
    return this.refresh();
  }

  async refresh() {
    return this
      .auditMarketingOperations();
  }

  async auditCampaignHealth() {
    return this
      .auditMarketingOperations();
  }

  async auditDeliverability() {
    return this
      .auditMarketingOperations();
  }

  async auditCapacity() {
    return this
      .auditMarketingOperations();
  }

  async auditSegments() {
    return this
      .auditMarketingOperations();
  }

  async auditMarketingOperations() {
    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness =
      "Live";

    const campaignRows =
      readCsv(
        INVENTORY_FILES
          .campaignStatus
      );

    const domainRows =
      readCsv(
        INVENTORY_FILES
          .domainStatus
      );

    const segmentRows =
      readCsv(
        INVENTORY_FILES
          .segmentInventory
      );

    const uploadQueue =
      safeReadJson(
        INVENTORY_FILES
          .leadUploadQueue,
        []
      );

    let instantlySnapshot;

    try {
      instantlySnapshot =
        await this.instantlyCOO
          .generateSnapshot();
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

        errors: [
          {
            area: "INSTANTLY",
            error: error.message
          }
        ]
      };
    }

    const campaignInventory =
      summarizeCampaignInventory(
        campaignRows
      );

    const domainInventory =
      summarizeDomainInventory(
        domainRows
      );

    const segmentInventory =
      summarizeSegments(
        segmentRows
      );

    const queueItems =
      Array.isArray(uploadQueue)
        ? uploadQueue
        : (
          Array.isArray(
            uploadQueue?.items
          )
            ? uploadQueue.items
            : Array.isArray(
              uploadQueue?.queue
            )
              ? uploadQueue.queue
              : []
        );

    const summary =
      instantlySnapshot.summary ||
      {};

    const criticalAccounts =
      Number(
        summary.criticalAccounts ||
        0
      );

    const criticalCampaigns =
      Number(
        summary.criticalCampaigns ||
        0
      );

    const warningAccounts =
      Number(
        summary.warningAccounts ||
        0
      );

    const warningCampaigns =
      Number(
        summary.warningCampaigns ||
        0
      );

    const protectedViolations =
      (
        instantlySnapshot
          .campaigns ||
        []
      ).filter(campaign =>
        Array.isArray(
          campaign
            .protectedAssignments
        ) &&
        campaign
          .protectedAssignments
          .length > 0
      );

    this.status =
      criticalAccounts > 0 ||
      criticalCampaigns > 0 ||
      protectedViolations.length > 0
        ? "Critical"
        : (
          warningAccounts > 0 ||
          warningCampaigns > 0 ||
          instantlySnapshot.ok ===
            false
            ? "Watch"
            : "Healthy"
        );

    this.metrics = {
      totalCampaigns:
        Number(
          summary.totalCampaigns ||
          0
        ),

      healthyCampaigns:
        Number(
          summary.healthyCampaigns ||
          0
        ),

      warningCampaigns,

      criticalCampaigns,

      totalAccounts:
        Number(
          summary.totalAccounts ||
          0
        ),

      campaignSafeAccounts:
        Number(
          summary
            .campaignSafeAccounts ||
          0
        ),

      protectedAccounts:
        Number(
          summary
            .protectedAccounts ||
          0
        ),

      warningAccounts,

      criticalAccounts,

      totalDailyCapacity:
        Number(
          summary
            .totalDailyCapacity ||
          0
        ),

      averageWarmupScore:
        summary
          .averageWarmupScore ??
        null,

      lowestWarmupScore:
        summary
          .lowestWarmupScore ??
        null,

      protectedAssignmentViolations:
        protectedViolations.length,

      campaignInventory,

      domainInventory,

      segmentInventory: {
        totalSegments:
          segmentInventory
            .totalSegments,

        totalLeads:
          segmentInventory
            .totalLeads,

        verifiedEmails:
          segmentInventory
            .verifiedEmails,

        uploadReadySegments:
          segmentInventory
            .uploadReadySegments,

        depletedSegments:
          segmentInventory
            .depletedSegments
      },

      queuedLeadUploads:
        queueItems.length
    };

    this.exceptions = [
      ...(
        instantlySnapshot
          .errors ||
        []
      ).map(item => ({
        type:
          "InstantlyAudit",

        severity:
          "Warning",

        message:
          `${item.area}: ${item.error}`
      })),

      ...protectedViolations
        .map(campaign => ({
          type:
            "ProtectedAccountAssignment",

          severity:
            "Critical",

          message:
            `Protected account assigned to campaign ${campaign.name || campaign.id}.`
        })),

      ...segmentInventory
        .depleted
        .slice(0, 25)
        .map(segment => ({
          type:
            "SegmentDepleted",

          severity:
            "Info",

          message:
            `Segment ${segment.name} has no campaign-ready verified email inventory.`
        }))
    ];

    this.recommendations = [
      ...(
        instantlySnapshot
          .recommendations ||
        []
      ),

      ...segmentInventory
        .uploadReady
        .slice(0, 25)
        .map(segment =>
          `Queue verified lead upload for segment ${segment.name} (${segment.verifiedEmailCount} verified emails).`
        ),

      ...segmentInventory
        .depleted
        .slice(0, 25)
        .map(segment =>
          `Enrich or replenish segment ${segment.name}.`
        )
    ];

    const result = {
      ok:
        this.status !==
          "Critical" ||
        instantlySnapshot.ok ===
          true,

      provider:
        "MarketingProvider",

      action:
        "auditMarketingOperations",

      status:
        this.status,

      generatedAt:
        this.lastRefresh,

      readOnly:
        true,

      metrics:
        this.metrics,

      exceptions:
        this.exceptions,

      recommendations:
        this.recommendations,

      instantly:
        instantlySnapshot,

      inventories: {
        campaigns:
          campaignInventory,

        domains:
          domainInventory,

        segments:
          segmentInventory,

        leadUploadQueue:
          queueItems
      },

      safety: {
        protectedWebsiteDomain:
          "pathways2gc.com",

        protectedAdminInbox:
          "info@pathways2gc.com",

        protectedFounderInbox:
          "kevin@pathways2gc.com",

        writesEnabled:
          this.writesEnabled,

        automaticPauseResume:
          false,

        automaticLeadUpload:
          false
      }
    };

    result.evidenceFile =
      persistEvidence(result);

    this.lastAudit =
      result;

    return result;
  }

  loadOperationQueue() {
    ensureOpsDir();

    const stored =
      safeReadJson(
        OPS_QUEUE_FILE,
        []
      );

    if (Array.isArray(stored)) {
      return stored;
    }

    if (
      Array.isArray(
        stored?.items
      )
    ) {
      return stored.items;
    }

    if (
      Array.isArray(
        stored?.queue
      )
    ) {
      return stored.queue;
    }

    return [];
  }

  saveOperationQueue(
    operations = []
  ) {
    ensureOpsDir();

    const queue =
      Array.isArray(operations)
        ? operations
        : [];

    safeWriteJson(
      OPS_QUEUE_FILE,
      queue
    );

    return queue;
  }

  validateProtectedAssets(
    input = {}
  ) {
    const payload =
      input &&
      typeof input === "object"
        ? input
        : {};

    const values = [
      payload.domain,
      payload.email,
      payload.inbox,
      payload.account,
      payload.sender,
      payload.from,

      ...(
        Array.isArray(
          payload.accounts
        )
          ? payload.accounts
          : []
      ),

      ...(
        Array.isArray(
          payload.inboxes
        )
          ? payload.inboxes
          : []
      ),

      ...(
        Array.isArray(
          payload.senderAccounts
        )
          ? payload.senderAccounts
          : []
      )
    ]
      .filter(Boolean)
      .map(value =>
        String(value)
          .trim()
          .toLowerCase()
      );

    const violations = [];

    for (const value of values) {
      if (
        PROTECTED_ASSETS
          .domains
          .some(domain =>
            value === domain ||
            value.endsWith(
              `@${domain}`
            )
          )
      ) {
        violations.push({
          type:
            "PROTECTED_DOMAIN",

          asset:
            value,

          reason:
            "The main P2GC website and administrative domain cannot be used for outbound campaign operations."
        });
      }

      if (
        PROTECTED_ASSETS
          .inboxes
          .includes(value)
      ) {
        violations.push({
          type:
            "PROTECTED_INBOX",

          asset:
            value,

          reason:
            "The administrative or founder inbox cannot be modified or assigned to outbound campaigns."
        });
      }
    }

    return {
      ok:
        violations.length === 0,

      violations
    };
  }

  queueOperation(
    input = {}
  ) {
    const operation =
      input &&
      typeof input === "object"
        ? {
          ...input
        }
        : {};

    const safety =
      this
        .validateProtectedAssets(
          operation.payload ||
          operation
        );

    if (!safety.ok) {
      return {
        ok: false,

        status:
          "BLOCKED",

        action:
          "queueOperation",

        reason:
          "PROTECTED_ASSET",

        violations:
          safety.violations
      };
    }

    const queue =
      this.loadOperationQueue();

    const now =
      new Date()
        .toISOString();

    const queuedOperation = {
      id:
        operation.id ||
        operationId("MKT"),

      provider:
        "MarketingProvider",

      operationType:
        operation.operationType ||
        operation.action ||
        "marketing_operation",

      capability:
        operation.capability ||
        operation.payload
          ?.capability ||
        null,

      objective:
        operation.objective ||
        operation.payload
          ?.objective ||
        null,

      payload:
        operation.payload &&
        typeof operation.payload ===
          "object"
          ? operation.payload
          : {},

      status:
        operation.status ||
        "QUEUED_FOR_APPROVAL",

      approvalRequired:
        operation
          .approvalRequired !==
        false,

      writesEnabled:
        this.writesEnabled,

      createdAt:
        operation.createdAt ||
        now,

      updatedAt:
        now,

      sourceTaskId:
        operation.sourceTaskId ||
        operation.taskId ||
        null
    };

    const duplicate =
      queue.find(item =>
        item.status !==
          "COMPLETED" &&
        item.operationType ===
          queuedOperation
            .operationType &&
        JSON.stringify(
          item.payload
        ) ===
          JSON.stringify(
            queuedOperation
              .payload
          )
      );

    if (duplicate) {
      return {
        ok: true,

        status:
          "ALREADY_QUEUED",

        action:
          "queueOperation",

        operation:
          duplicate,

        queueFile:
          OPS_QUEUE_FILE
      };
    }

    queue.push(
      queuedOperation
    );

    this.saveOperationQueue(
      queue
    );

    safeWriteJson(
      OPS_LATEST_FILE,
      queuedOperation
    );

    return {
      ok: true,

      status:
        queuedOperation.status,

      action:
        "queueOperation",

      operation:
        queuedOperation,

      queueFile:
        OPS_QUEUE_FILE
    };
  }

  async queueLeadUpload(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const segmentName =
      payload.segmentName ||
      payload.segment ||
      payload.name;

    if (!segmentName) {
      return {
        ok: false,

        status:
          "INVALID",

        action:
          "queueLeadUpload",

        reason:
          "segmentName is required."
      };
    }

    const verifiedEmailCount =
      Number(
        payload
          .verifiedEmailCount ||
        payload
          .verifiedEmails ||
        payload.leadCount ||
        0
      );

    return this.queueOperation({
      operationType:
        "LEAD_UPLOAD",

      capability:
        payload.capability ||
        "revenue.outbound.lead_upload",

      objective:
        payload.objective ||
        `Upload verified leads for ${segmentName}.`,

      sourceTaskId:
        task.id ||
        null,

      payload: {
        segmentName,

        verifiedEmailCount,

        sourceFile:
          payload.sourceFile ||
          null,

        campaignId:
          payload.campaignId ||
          null,

        campaignName:
          payload.campaignName ||
          null,

        listId:
          payload.listId ||
          null,

        deduplicate:
          payload.deduplicate !==
          false,

        verifyBeforeUpload:
          payload
            .verifyBeforeUpload !==
          false
      }
    });
  }

  async pauseCampaign(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const campaignId =
      payload.campaignId ||
      payload.id ||
      null;

    const campaignName =
      payload.campaignName ||
      payload.name ||
      null;

    if (
      !campaignId &&
      !campaignName
    ) {
      return {
        ok: false,

        status:
          "INVALID",

        action:
          "pauseCampaign",

        reason:
          "campaignId or campaignName is required."
      };
    }

    return this.queueOperation({
      operationType:
        "CAMPAIGN_PAUSE",

      capability:
        payload.capability ||
        "revenue.outbound.campaign.pause",

      objective:
        payload.objective ||
        `Pause campaign ${campaignName || campaignId}.`,

      sourceTaskId:
        task.id ||
        null,

      payload: {
        campaignId,

        campaignName,

        reason:
          payload.reason ||
          "Governed campaign safety action.",

        account:
          payload.account ||
          null,

        domain:
          payload.domain ||
          null
      }
    });
  }

  async resumeCampaign(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const campaignId =
      payload.campaignId ||
      payload.id ||
      null;

    const campaignName =
      payload.campaignName ||
      payload.name ||
      null;

    if (
      !campaignId &&
      !campaignName
    ) {
      return {
        ok: false,

        status:
          "INVALID",

        action:
          "resumeCampaign",

        reason:
          "campaignId or campaignName is required."
      };
    }

    return this.queueOperation({
      operationType:
        "CAMPAIGN_RESUME",

      capability:
        payload.capability ||
        "revenue.outbound.campaign.resume",

      objective:
        payload.objective ||
        `Resume campaign ${campaignName || campaignId}.`,

      sourceTaskId:
        task.id ||
        null,

      payload: {
        campaignId,

        campaignName,

        reason:
          payload.reason ||
          "Governed campaign activation action.",

        account:
          payload.account ||
          null,

        domain:
          payload.domain ||
          null
      }
    });
  }

  async createCampaign(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const campaignName =
      payload.campaignName ||
      payload.name;

    if (!campaignName) {
      return {
        ok: false,

        status:
          "INVALID",

        action:
          "createCampaign",

        reason:
          "campaignName is required."
      };
    }

    return this.queueOperation({
      operationType:
        "CAMPAIGN_CREATE",

      capability:
        payload.capability ||
        "revenue.outbound.campaign.create",

      objective:
        payload.objective ||
        `Create outbound campaign ${campaignName}.`,

      sourceTaskId:
        task.id ||
        null,

      payload: {
        campaignName,

        segmentName:
          payload.segmentName ||
          null,

        senderAccounts:
          Array.isArray(
            payload.senderAccounts
          )
            ? payload.senderAccounts
            : [],

        sequence:
          Array.isArray(
            payload.sequence
          )
            ? payload.sequence
            : [],

        schedule:
          payload.schedule ||
          null,

        dailyLimit:
          Number(
            payload.dailyLimit ||
            0
          ),

        tracking:
          payload.tracking ||
          null,

        launchImmediately:
          payload
            .launchImmediately ===
          true
      }
    });
  }

  async listOperations(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const requestedStatus =
      payload.status
        ? String(
          payload.status
        ).toUpperCase()
        : null;

    const queue =
      this.loadOperationQueue();

    const operations =
      requestedStatus
        ? queue.filter(item =>
          String(
            item.status
          ).toUpperCase() ===
            requestedStatus
        )
        : queue;

    return {
      ok: true,

      status:
        "READY",

      action:
        "listOperations",

      total:
        operations.length,

      writesEnabled:
        this.writesEnabled,

      operations,

      queueFile:
        OPS_QUEUE_FILE
    };
  }

  async planMarketingActions(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const audit =
      await this
        .auditMarketingOperations();

    const plannedOperations = [];

    const uploadReady =
      audit.inventories
        ?.segments
        ?.uploadReady ||
      [];

    const maximumUploads =
      Math.max(
        0,
        Number(
          payload.maximumUploads ||
          payload.maxOperations ||
          10
        )
      );

    for (
      const segment of
      uploadReady.slice(
        0,
        maximumUploads
      )
    ) {
      const queued =
        await this
          .queueLeadUpload({
            id:
              task.id ||
              null,

            payload: {
              capability:
                "revenue.outbound.lead_upload",

              objective:
                `Prepare verified outbound inventory for ${segment.name}.`,

              segmentName:
                segment.name,

              verifiedEmailCount:
                segment
                  .verifiedEmailCount,

              campaignName:
                segment
                  .campaignStatus &&
                !/unknown/i.test(
                  segment
                    .campaignStatus
                )
                  ? segment
                    .campaignStatus
                  : null,

              deduplicate:
                true,

              verifyBeforeUpload:
                true
            }
          });

      if (queued.operation) {
        plannedOperations.push(
          queued.operation
        );
      }
    }

    const campaigns =
      audit.instantly
        ?.campaigns ||
      [];

    const criticalCampaigns =
      campaigns.filter(
        campaign => {
          const status =
            String(
              campaign.health ||
              campaign
                .healthStatus ||
              campaign
                .statusLabel ||
              ""
            ).toLowerCase();

          return (
            status.includes(
              "critical"
            ) ||
            Number(
              campaign
                .bounceRate ||
              0
            ) >= 5 ||
            (
              Array.isArray(
                campaign
                  .protectedAssignments
              ) &&
              campaign
                .protectedAssignments
                .length > 0
            )
          );
        }
      );

    for (
      const campaign of
      criticalCampaigns.slice(
        0,
        10
      )
    ) {
      const queued =
        await this
          .pauseCampaign({
            id:
              task.id ||
              null,

            payload: {
              campaignId:
                campaign.id ||
                null,

              campaignName:
                campaign.name ||
                null,

              reason:
                "Critical deliverability condition or protected-account assignment detected by MarketingProvider audit."
            }
          });

      if (queued.operation) {
        plannedOperations.push(
          queued.operation
        );
      }
    }

    const deduplicatedOperations =
      uniqueBy(
        plannedOperations,
        operation =>
          operation.id
      );

    const result = {
      ok:
        audit.ok,

      provider:
        "MarketingProvider",

      action:
        "planMarketingActions",

      status:
        audit.status ===
          "Critical"
          ? "PLANNED_WITH_RISK"
          : "PLANNED",

      generatedAt:
        new Date()
          .toISOString(),

      objective:
        payload.objective ||
        "Identify and queue the next safe revenue-producing outbound actions.",

      writesEnabled:
        this.writesEnabled,

      externalWritesPerformed:
        false,

      plannedOperations:
        deduplicatedOperations,

      plannedOperationCount:
        deduplicatedOperations
          .length,

      recommendations:
        audit.recommendations ||
        [],

      exceptions:
        audit.exceptions ||
        [],

      audit,

      queueFile:
        OPS_QUEUE_FILE,

      safety: {
        protectedAssets:
          PROTECTED_ASSETS,

        approvalRequired:
          true,

        writesEnabled:
          this.writesEnabled
      }
    };

    result.evidenceFile =
      persistEvidence(result);

    return result;
  }

  async executeApprovedOperation(
    task = {}
  ) {
    const payload =
      getTaskPayload(task);

    const operationIdValue =
      payload.operationId ||
      payload.id ||
      task.operationId ||
      null;

    if (!operationIdValue) {
      return {
        ok: false,

        status:
          "INVALID",

        action:
          "executeApprovedOperation",

        reason:
          "operationId is required."
      };
    }

    const queue =
      this.loadOperationQueue();

    const index =
      queue.findIndex(
        operation =>
          operation.id ===
          operationIdValue
      );

    if (index < 0) {
      return {
        ok: false,

        status:
          "NOT_FOUND",

        action:
          "executeApprovedOperation",

        operationId:
          operationIdValue
      };
    }

    const operation =
      queue[index];

    if (
      operation.status !==
        "APPROVED" &&
      payload.approved !==
        true
    ) {
      return {
        ok: false,

        status:
          "APPROVAL_REQUIRED",

        action:
          "executeApprovedOperation",

        operation
      };
    }

    const safety =
      this
        .validateProtectedAssets(
          operation.payload ||
          {}
        );

    if (!safety.ok) {
      operation.status =
        "BLOCKED";

      operation.updatedAt =
        new Date()
          .toISOString();

      operation.violations =
        safety.violations;

      queue[index] =
        operation;

      this.saveOperationQueue(
        queue
      );

      return {
        ok: false,

        status:
          "BLOCKED",

        action:
          "executeApprovedOperation",

        operation,

        violations:
          safety.violations
      };
    }

    if (!this.writesEnabled) {
      return {
        ok: false,

        status:
          "WRITES_DISABLED",

        action:
          "executeApprovedOperation",

        operation,

        reason:
          "Set MILES_MARKETING_WRITES_ENABLED=true only after the live Instantly execution adapter has been verified."
      };
    }

    if (
      !this.operationExecutor
    ) {
      return {
        ok: false,

        status:
          "EXECUTOR_UNAVAILABLE",

        action:
          "executeApprovedOperation",

        operation,

        reason:
          "No governed marketing operation executor was supplied to MarketingProvider."
      };
    }

    operation.status =
      "EXECUTING";

    operation.updatedAt =
      new Date()
        .toISOString();

    queue[index] =
      operation;

    this.saveOperationQueue(
      queue
    );

    try {
      const executionResult =
        await this
          .operationExecutor(
            operation
          );

      operation.status =
        executionResult?.ok ===
          false
          ? "FAILED"
          : "COMPLETED";

      operation.updatedAt =
        new Date()
          .toISOString();

      operation.executionResult =
        executionResult;

      queue[index] =
        operation;

      this.saveOperationQueue(
        queue
      );

      safeWriteJson(
        OPS_LATEST_FILE,
        operation
      );

      return {
        ok:
          operation.status ===
          "COMPLETED",

        status:
          operation.status,

        action:
          "executeApprovedOperation",

        operation,

        executionResult
      };
    } catch (error) {
      operation.status =
        "FAILED";

      operation.updatedAt =
        new Date()
          .toISOString();

      operation.error =
        error.message;

      queue[index] =
        operation;

      this.saveOperationQueue(
        queue
      );

      safeWriteJson(
        OPS_LATEST_FILE,
        operation
      );

      return {
        ok: false,

        status:
          "FAILED",

        action:
          "executeApprovedOperation",

        operation,

        error:
          error.message
      };
    }
  }

  getCampaignByName(name) {
    const campaigns =
      this.lastAudit
        ?.instantly
        ?.campaigns ||
      [];

    return campaigns.find(
      campaign =>
        campaign.name === name
    ) || null;
  }

  getActiveCampaigns() {
    const campaigns =
      this.lastAudit
        ?.instantly
        ?.campaigns ||
      [];

    return campaigns.filter(
      campaign =>
        campaign.status === 1 ||
        String(
          campaign.status
        ).toLowerCase() ===
          "active"
    );
  }

  async executeTask(
    task = {}
  ) {
    const requestedAction =
      task.payload?.action ||
      task.action ||
      "auditMarketingOperations";

    const aliases = {
      refresh:
        "refresh",

      initialize:
        "initialize",

      audit:
        "auditMarketingOperations",

      audit_marketing_operations:
        "auditMarketingOperations",

      campaign_audit:
        "auditCampaignHealth",

      deliverability_audit:
        "auditDeliverability",

      capacity_audit:
        "auditCapacity",

      segment_audit:
        "auditSegments",

      plan_marketing_actions:
        "planMarketingActions",

      revenue_outbound_plan:
        "planMarketingActions",

      lead_upload:
        "queueLeadUpload",

      queue_lead_upload:
        "queueLeadUpload",

      campaign_pause:
        "pauseCampaign",

      pause_campaign:
        "pauseCampaign",

      campaign_resume:
        "resumeCampaign",

      resume_campaign:
        "resumeCampaign",

      campaign_create:
        "createCampaign",

      create_campaign:
        "createCampaign",

      list_operations:
        "listOperations",

      marketing_operations_list:
        "listOperations",

      execute_approved_operation:
        "executeApprovedOperation"
    };

    const normalized =
      normalizeAction(
        requestedAction
      );

    const action =
      aliases[normalized] ||
      requestedAction;

    if (
      typeof this[action] !==
      "function"
    ) {
      throw new Error(
        `Unsupported MarketingProvider action: ${requestedAction}`
      );
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports =
  MarketingProvider;