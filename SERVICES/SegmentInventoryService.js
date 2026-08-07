"use strict";
const CanonicalDatasetRegistry =
    require("./CanonicalDatasetRegistry");
const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const DEFAULT_INVENTORY_FILE =
  process.env.MILES_SEGMENT_INVENTORY_FILE ||
  path.join(
    ROOT,
    "DATA",
    "OUTBOUND",
    "SEGMENT_INVENTORY_MASTER.csv"
  );

const DEFAULT_OUTPUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "segment_intelligence"
  );

const FIELD_ALIASES = Object.freeze({
  segmentName: [
    "SegmentName",
    "Segment_Name",
    "segment_name",
    "Segment",
    "segment",
    "PrimarySegment",
    "Primary_Segment",
    "primary_segment",
    "Name",
    "name"
  ],

  companyCount: [
    "Companies",
    "CompanyCount",
    "Company_Count",
    "company_count",
    "LeadCount",
    "Lead_Count",
    "lead_count",
    "TotalLeads",
    "Total_Leads",
    "total_leads",
    "Rows",
    "rows"
  ],

  contactCount: [
    "Contacts",
    "ContactCount",
    "Contact_Count",
    "contact_count",
    "TotalContacts",
    "Total_Contacts",
    "total_contacts"
  ],

  verifiedEmailCount: [
    "VerifiedEmails",
    "Verified_Email_Count",
    "verified_email_count",
    "Verified_Emails",
    "verified_emails",
    "EmailReadyCount",
    "Email_Ready_Count",
    "email_ready_count"
  ],

  verificationPercent: [
    "VerificationPercent",
    "Verification_Percent",
    "verification_percent",
    "VerifiedPercent",
    "Verified_Percent",
    "verified_percent"
  ],

  campaignName: [
    "Campaign",
    "CampaignName",
    "Campaign_Name",
    "campaign_name",
    "InstantlyCampaign",
    "Instantly_Campaign",
    "instantly_campaign"
  ],

  campaignStatus: [
    "CampaignStatus",
    "Campaign_Status",
    "campaign_status",
    "Status",
    "status"
  ],

  assignedDomain: [
    "AssignedDomain",
    "Assigned_Domain",
    "assigned_domain",
    "Domain",
    "domain"
  ],

  assignedInboxes: [
    "AssignedInboxes",
    "Assigned_Inboxes",
    "assigned_inboxes",
    "Inboxes",
    "inboxes",
    "SenderAccounts",
    "Sender_Accounts",
    "sender_accounts"
  ],

  sourceFile: [
    "SourceFile",
    "Source_File",
    "source_file",
    "CSVFile",
    "CSV_File",
    "csv_file",
    "FilePath",
    "File_Path",
    "file_path"
  ],

  instantlyListId: [
    "InstantlyListId",
    "Instantly_List_ID",
    "instantly_list_id",
    "ListId",
    "List_ID",
    "list_id"
  ],

  needsUpload: [
    "NeedsUpload",
    "Needs_Upload",
    "needs_upload"
  ],

  needsEnrichment: [
    "NeedsEnrichment",
    "Needs_Enrichment",
    "needs_enrichment"
  ],

  priority: [
    "Priority",
    "priority",
    "PriorityRank",
    "Priority_Rank",
    "priority_rank"
  ]
});

const PROTECTED_DOMAINS =
  new Set([
    "pathways2gc.com"
  ]);

const PROTECTED_INBOXES =
  new Set([
    "info@pathways2gc.com",
    "kevin@pathways2gc.com"
  ]);

function ensureDirectory(directoryPath) {
  fs.mkdirSync(
    directoryPath,
    {
      recursive: true
    }
  );
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
    const character =
      line[index];

    if (character === "\"") {
      if (
        quoted &&
        line[index + 1] === "\""
      ) {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (
      character === "," &&
      !quoted
    ) {
      values.push(
        current.trim()
      );

      current = "";
      continue;
    }

    current += character;
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

  const lines =
    fs.readFileSync(
      filePath,
      "utf8"
    )
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
  aliases,
  fallback = ""
) {
  for (const alias of aliases) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(record, alias)
    ) {
      const value =
        record[alias];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        return value;
      }
    }
  }

  return fallback;
}

function normalizeUnknown(value) {
  const normalized =
    String(value ?? "")
      .trim();

  if (
    !normalized ||
    /^(unknown|n\/a|na|null|none|planned)$/i
      .test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function numericValue(
  record,
  aliases,
  fallback = 0
) {
  const raw =
    normalizeUnknown(
      firstValue(
        record,
        aliases,
        ""
      )
    );

  if (raw === null) {
    return fallback;
  }

  const cleaned =
    String(raw)
      .replace(/[$,%\s]/g, "")
      .replace(/,/g, "");

  const number =
    Number(cleaned);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function optionalBoolean(
  record,
  aliases
) {
  const raw =
    normalizeUnknown(
      firstValue(
        record,
        aliases,
        ""
      )
    );

  if (raw === null) {
    return null;
  }

  const value =
    String(raw)
      .trim()
      .toLowerCase();

  if (
    [
      "1",
      "true",
      "yes",
      "y",
      "ready",
      "active"
    ].includes(value)
  ) {
    return true;
  }

  if (
    [
      "0",
      "false",
      "no",
      "n",
      "not ready",
      "inactive"
    ].includes(value)
  ) {
    return false;
  }

  return null;
}

function splitList(value) {
  const normalized =
    normalizeUnknown(value);

  if (!normalized) {
    return [];
  }

  return String(normalized)
    .split(/[;,|]/)
    .map(item =>
      item.trim()
    )
    .filter(Boolean);
}

function normalizeInbox(
  inbox,
  domain
) {
  const value =
    String(inbox || "")
      .trim()
      .toLowerCase();

  if (!value) {
    return null;
  }

  if (
    value.endsWith("@") &&
    domain
  ) {
    return `${value}${domain}`;
  }

  return value;
}

function deriveCampaignStatus(
  campaignName,
  rawStatus,
  verifiedEmailCount
) {
  const status =
    normalizeUnknown(rawStatus);

  if (status) {
    return status;
  }

  if (
    campaignName &&
    verifiedEmailCount > 0
  ) {
    return "READY_FOR_REVIEW";
  }

  if (campaignName) {
    return "INVENTORY_REQUIRED";
  }

  return "NOT_CONFIGURED";
}

function calculatePriority(
  segmentName,
  explicitPriority
) {
  if (
    Number.isFinite(
      explicitPriority
    ) &&
    explicitPriority > 0
  ) {
    return explicitPriority;
  }

  const name =
    String(segmentName || "")
      .toLowerCase();

  if (
    name.includes("expired")
  ) {
    return 1;
  }

  if (
    name.includes("expiring") &&
    (
      name.includes("6 month") ||
      name.includes("6m")
    )
  ) {
    return 2;
  }

  if (
    name.includes("expiring") &&
    (
      name.includes("12 month") ||
      name.includes("12m")
    )
  ) {
    return 3;
  }

  if (name.includes("gsa")) {
    return 4;
  }

  if (
    name.includes("va ") ||
    name.startsWith("va")
  ) {
    return 5;
  }

  if (name.includes("sam")) {
    return 6;
  }

  if (
    name.includes("8(a)") ||
    name.includes("8a") ||
    name.includes("hubzone") ||
    name.includes("wosb") ||
    name.includes("sdvosb") ||
    name.includes("vosb")
  ) {
    return 7;
  }

  if (name.includes("sbs")) {
    return 8;
  }

  return 99;
}

function safeWriteJson(
  filePath,
  data
) {
  ensureDirectory(
    path.dirname(filePath)
  );

  const temporaryFile =
    `${filePath}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(
      data,
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    temporaryFile,
    filePath
  );

  return filePath;
}

class SegmentInventoryService {
  constructor(options = {}) {

    this.rootDir =
        options.rootDir || ROOT;

    this.registry =
        options.registry ||
        new CanonicalDatasetRegistry();

    const registryInventory =
        this.registry.getRegistry().inventory;

    this.inventoryFile =
        options.inventoryFile ||
        registryInventory?.segmentInventory ||
        DEFAULT_INVENTORY_FILE;

    this.outputDir =
        options.outputDir ||
        DEFAULT_OUTPUT_DIR;
}

  normalizeRow(
    record,
    index = 0
  ) {
    const segmentName =
      normalizeUnknown(
        firstValue(
          record,
          FIELD_ALIASES.segmentName,
          ""
        )
      ) ||
      `Unnamed Segment ${index + 1}`;

    const companyCount =
      numericValue(
        record,
        FIELD_ALIASES.companyCount,
        0
      );

    const contactCount =
      numericValue(
        record,
        FIELD_ALIASES.contactCount,
        0
      );

    const verifiedEmailCount =
      numericValue(
        record,
        FIELD_ALIASES.verifiedEmailCount,
        0
      );

    const verificationPercent =
      numericValue(
        record,
        FIELD_ALIASES.verificationPercent,
        0
      );

    const campaignName =
      normalizeUnknown(
        firstValue(
          record,
          FIELD_ALIASES.campaignName,
          ""
        )
      );

    const assignedDomain =
      normalizeUnknown(
        firstValue(
          record,
          FIELD_ALIASES.assignedDomain,
          ""
        )
      )?.toLowerCase() ||
      null;

    const assignedInboxes =
      splitList(
        firstValue(
          record,
          FIELD_ALIASES.assignedInboxes,
          ""
        )
      )
        .map(inbox =>
          normalizeInbox(
            inbox,
            assignedDomain
          )
        )
        .filter(Boolean);

    const sourceFile =
      normalizeUnknown(
        firstValue(
          record,
          FIELD_ALIASES.sourceFile,
          ""
        )
      );

    const instantlyListId =
      normalizeUnknown(
        firstValue(
          record,
          FIELD_ALIASES.instantlyListId,
          ""
        )
      );

    const explicitNeedsUpload =
      optionalBoolean(
        record,
        FIELD_ALIASES.needsUpload
      );

    const explicitNeedsEnrichment =
      optionalBoolean(
        record,
        FIELD_ALIASES.needsEnrichment
      );

    const rawCampaignStatus =
      firstValue(
        record,
        FIELD_ALIASES.campaignStatus,
        ""
      );

    const campaignStatus =
      deriveCampaignStatus(
        campaignName,
        rawCampaignStatus,
        verifiedEmailCount
      );

    const needsEnrichment =
      explicitNeedsEnrichment !==
        null
        ? explicitNeedsEnrichment
        : (
          companyCount > 0 &&
          verifiedEmailCount === 0
        );

    const needsUpload =
      explicitNeedsUpload !== null
        ? explicitNeedsUpload
        : (
          verifiedEmailCount > 0 &&
          ![
            "ACTIVE",
            "UPLOADED",
            "RUNNING",
            "COMPLETE",
            "COMPLETED"
          ].includes(
            String(campaignStatus)
              .toUpperCase()
          )
        );

    const protectedDomain =
      assignedDomain
        ? PROTECTED_DOMAINS.has(
          assignedDomain
        )
        : false;

    const protectedInboxes =
      assignedInboxes.filter(
        inbox =>
          PROTECTED_INBOXES.has(
            inbox
          ) ||
          inbox.endsWith(
            "@pathways2gc.com"
          )
      );

    const priority =
      calculatePriority(
        segmentName,
        numericValue(
          record,
          FIELD_ALIASES.priority,
          0
        )
      );

    const blockers = [];

    if (verifiedEmailCount === 0) {
      blockers.push(
        "NO_VERIFIED_EMAILS"
      );
    }

    if (!sourceFile) {
      blockers.push(
        "SOURCE_FILE_NOT_MAPPED"
      );
    }

    if (!campaignName) {
      blockers.push(
        "CAMPAIGN_NOT_MAPPED"
      );
    }

    if (!assignedDomain) {
      blockers.push(
        "DOMAIN_NOT_ASSIGNED"
      );
    }

    if (
      assignedInboxes.length === 0
    ) {
      blockers.push(
        "INBOXES_NOT_ASSIGNED"
      );
    }

    if (protectedDomain) {
      blockers.push(
        "PROTECTED_DOMAIN"
      );
    }

    if (
      protectedInboxes.length > 0
    ) {
      blockers.push(
        "PROTECTED_INBOX"
      );
    }

    const uploadReady =
      verifiedEmailCount > 0 &&
      needsUpload &&
      !needsEnrichment &&
      Boolean(sourceFile) &&
      !protectedDomain &&
      protectedInboxes.length === 0;

    const campaignReady =
      uploadReady &&
      Boolean(campaignName) &&
      Boolean(assignedDomain) &&
      assignedInboxes.length > 0;

    return {
      segmentName,
      name: segmentName,

      companyCount,
      leadCount: companyCount,

      contactCount,

      verifiedEmailCount,
      verifiedEmails:
        verifiedEmailCount,

      verificationPercent,

      campaignName,
      campaignStatus,

      assignedDomain,
      assignedInboxes,

      sourceFile,
      instantlyListId,

      needsUpload,
      needsEnrichment,

      uploadReady,
      campaignReady,

      priority,

      protectedDomain,
      protectedInboxes,

      blockers,

      sourceRecord: record
    };
  }

  loadRows() {
    return readCsv(
      this.inventoryFile
    );
  }

  getInventory() {
    const generatedAt =
      new Date().toISOString();

    const rows =
      this.loadRows();

    const segments =
      rows
        .map(
          (row, index) =>
            this.normalizeRow(
              row,
              index
            )
        )
        .sort(
          (left, right) =>
            left.priority -
              right.priority ||
            left.segmentName
              .localeCompare(
                right.segmentName
              )
        );

    const uploadReady =
      segments.filter(
        segment =>
          segment.uploadReady
      );

    const campaignReady =
      segments.filter(
        segment =>
          segment.campaignReady
      );

    const needsEnrichment =
      segments.filter(
        segment =>
          segment.needsEnrichment
      );

    const needsUpload =
      segments.filter(
        segment =>
          segment.needsUpload
      );

    const protectedViolations =
      segments.filter(
        segment =>
          segment.protectedDomain ||
          segment
            .protectedInboxes
            .length > 0
      );

    const missingSourceFiles =
      segments.filter(
        segment =>
          !segment.sourceFile
      );

    const totalCompanies =
      segments.reduce(
        (sum, segment) =>
          sum +
          segment.companyCount,
        0
      );

    const totalContacts =
      segments.reduce(
        (sum, segment) =>
          sum +
          segment.contactCount,
        0
      );

    const totalVerifiedEmails =
      segments.reduce(
        (sum, segment) =>
          sum +
          segment
            .verifiedEmailCount,
        0
      );

    const result = {
      ok:
        fs.existsSync(
          this.inventoryFile
        ),

      service:
        "SegmentInventoryService",

      status:
        fs.existsSync(
          this.inventoryFile
        )
          ? "READY"
          : "INVENTORY_FILE_MISSING",

      generatedAt,

      inventoryFile:
        this.inventoryFile,

      summary: {
        totalSegments:
          segments.length,

        totalCompanies,

        totalLeads:
          totalCompanies,

        totalContacts,

        totalVerifiedEmails,

        verifiedEmails:
          totalVerifiedEmails,

        uploadReadySegments:
          uploadReady.length,

        campaignReadySegments:
          campaignReady.length,

        needsEnrichmentSegments:
          needsEnrichment.length,

        needsUploadSegments:
          needsUpload.length,

        protectedViolations:
          protectedViolations.length,

        missingSourceFiles:
          missingSourceFiles.length
      },

      uploadReady,

      campaignReady,

      needsEnrichment,

      needsUpload,

      protectedViolations,

      missingSourceFiles,

      segments
    };

    ensureDirectory(
      this.outputDir
    );

    result.evidenceFile =
      safeWriteJson(
        path.join(
          this.outputDir,
          "latest_segment_inventory.json"
        ),
        result
      );

    return result;
  }

  getSegmentByName(name) {
    const requestedName =
      String(name || "")
        .trim()
        .toLowerCase();

    if (!requestedName) {
      return null;
    }

    const inventory =
      this.getInventory();

    return inventory
      .segments
      .find(
        segment =>
          segment
            .segmentName
            .toLowerCase() ===
          requestedName
      ) ||
      null;
  }

  getUploadReadySegments(
    limit = 25
  ) {
    const inventory =
      this.getInventory();

    return inventory
      .uploadReady
      .slice(
        0,
        Math.max(
          0,
          Number(limit) || 25
        )
      );
  }

  getCampaignReadySegments(
    limit = 25
  ) {
    const inventory =
      this.getInventory();

    return inventory
      .campaignReady
      .slice(
        0,
        Math.max(
          0,
          Number(limit) || 25
        )
      );
  }

  async executeTask(task = {}) {
    const action =
      task.payload?.action ||
      task.action ||
      "getInventory";

    const aliases = {
      refresh:
        "getInventory",

      audit:
        "getInventory",

      segment_inventory:
        "getInventory",

      get_segment_inventory:
        "getInventory",

      upload_ready:
        "getUploadReadySegments",

      campaign_ready:
        "getCampaignReadySegments"
    };

    const normalized =
      String(action)
        .trim()
        .replace(/[\s.-]+/g, "_")
        .toLowerCase();

    const method =
      aliases[normalized] ||
      action;

    if (
      typeof this[method] !==
      "function"
    ) {
      throw new Error(
        `Unsupported SegmentInventoryService action: ${action}`
      );
    }

    if (
      method ===
        "getUploadReadySegments" ||
      method ===
        "getCampaignReadySegments"
    ) {
      const limit =
        task.payload?.limit ||
        task.limit ||
        25;

      return this[method](limit);
    }

    return this[method]();
  }
}

module.exports = SegmentInventoryService;
module.exports.SegmentInventoryService = SegmentInventoryService;
module.exports.default = SegmentInventoryService;
