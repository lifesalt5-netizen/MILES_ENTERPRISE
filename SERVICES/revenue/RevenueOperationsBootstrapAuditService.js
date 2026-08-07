"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

class RevenueOperationsBootstrapAuditService {
  constructor(options = {}) {
    this.service = "REVENUE_OPERATIONS_BOOTSTRAP_AUDIT";
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.outputPath = options.outputPath || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "revenue_bootstrap_audit.json"
    );
    this.env = options.env || process.env;
    this.connectorHealth = options.connectorHealth || null;
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.contracts = [
      {
        id: "instantlyWorker",
        path: "SERVICES/workers/InstantlyCOOWorker.js",
        markers: ["SYNC_CAMPAIGNS", "SYNC_SEGMENTS", "UPLOAD_LEADS", "CHECK_DELIVERABILITY"]
      },
      {
        id: "instantlyConnector",
        path: "CONNECTORS/INSTANTLY/connector.js",
        markers: ["healthCheck", "listCampaigns", "createLead"]
      },
      {
        id: "instantlyApiClient",
        path: "SERVICES/InstantlyApiClient.js",
        markers: ["INSTANTLY_API_KEY", "credentialsPresent", "async request"]
      },
      {
        id: "segmentInventoryService",
        path: "SERVICES/SegmentInventoryService.js",
        markers: ["SEGMENT_INVENTORY_MASTER.csv", "verifiedEmailCount", "needsUpload"]
      },
      {
        id: "capabilityRegistry",
        path: "SERVICES/CapabilityService.js",
        markers: ["revenue.outbound.audit", "marketing.segment.replenish", "MarketingProvider"]
      },
      {
        id: "providerRouter",
        path: "SERVICES/ProviderRouterService.js",
        markers: ["MarketingProvider"]
      }
    ];
    this.inventoryPaths = {
      canonicalSegmentInventory: path.join(
        this.rootDir, "DATA", "OUTBOUND", "SEGMENT_INVENTORY_MASTER.csv"
      ),
      workerSegmentInventory: path.join(
        this.rootDir, "runtime", "instantly_coo", "segment_inventory.json"
      ),
      campaignRegistry: path.join(
        this.rootDir, "runtime", "instantly_coo", "campaign_registry.json"
      ),
      leadUploadQueue: path.join(
        this.rootDir, "runtime", "instantly_coo", "lead_upload_queue.json"
      ),
      workerRegistry: path.join(
        this.rootDir, "runtime", "worker_registry", "registered_workers.json"
      )
    };
  }

  inspectContract(contract) {
    const filePath = path.join(this.rootDir, ...contract.path.split("/"));
    if (!fs.existsSync(filePath)) {
      return { ...contract, ok: false, exists: false, missingMarkers: contract.markers };
    }
    const content = fs.readFileSync(filePath, "utf8");
    const missingMarkers = contract.markers.filter(marker => !content.includes(marker));
    return {
      id: contract.id,
      path: contract.path,
      ok: missingMarkers.length === 0,
      exists: true,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: sha256(Buffer.from(content, "utf8")),
      missingMarkers
    };
  }

  readJsonArray(filePath, label) {
    if (!fs.existsSync(filePath)) {
      return { label, ok: false, exists: false, count: 0, error: "MISSING" };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
      if (!Array.isArray(parsed)) throw new Error("NOT_ARRAY");
      return {
        label,
        ok: true,
        exists: true,
        count: parsed.length,
        bytes: fs.statSync(filePath).size,
        sha256: sha256(fs.readFileSync(filePath))
      };
    } catch (error) {
      return { label, ok: false, exists: true, count: 0, error: error.message };
    }
  }

  inspectCsv(filePath, label) {
    if (!fs.existsSync(filePath)) {
      return { label, ok: false, exists: false, rows: 0, error: "MISSING" };
    }
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    const header = lines[0] || "";
    const required = ["segment", "verified"];
    const missingColumns = required.filter(value => !header.toLowerCase().includes(value));
    return {
      label,
      ok: lines.length > 1 && missingColumns.length === 0,
      exists: true,
      rows: Math.max(0, lines.length - 1),
      bytes: Buffer.byteLength(text, "utf8"),
      sha256: sha256(Buffer.from(text, "utf8")),
      missingColumns
    };
  }

  inspectWorkerRegistry() {
    const filePath = this.inventoryPaths.workerRegistry;
    if (!fs.existsSync(filePath)) {
      return { ok: false, exists: false, instantlyWorkerRegistered: false, error: "MISSING" };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
      const values = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.workers)
          ? parsed.workers
          : Object.values(parsed);
      const instantlyWorkerRegistered = values.some(value =>
        /instantly/i.test(String(value?.name || value?.workerId || value?.id || value))
      );
      return {
        ok: instantlyWorkerRegistered,
        exists: true,
        workerCount: values.length,
        instantlyWorkerRegistered
      };
    } catch (error) {
      return { ok: false, exists: true, instantlyWorkerRegistered: false, error: error.message };
    }
  }

  async inspectLiveConnector(live) {
    if (!live) {
      return { ok: null, checked: false, status: "NOT_REQUESTED" };
    }
    try {
      let result;
      if (this.connectorHealth) {
        result = await this.connectorHealth();
      } else {
        const connector = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "connector.js"));
        result = await connector.healthCheck();
      }
      return {
        ok: result?.ok === true,
        checked: true,
        status: result?.status || (result?.ok ? "HEALTHY" : "DEGRADED"),
        httpStatus: result?.httpStatus || null,
        error: result?.error || result?.message || null
      };
    } catch (error) {
      return { ok: false, checked: true, status: "ERROR", error: error.message };
    }
  }

  async audit(input = {}) {
    const contracts = this.contracts.map(contract => this.inspectContract(contract));
    const inventories = {
      canonicalSegmentInventory: this.inspectCsv(
        this.inventoryPaths.canonicalSegmentInventory,
        "canonicalSegmentInventory"
      ),
      workerSegmentInventory: this.readJsonArray(
        this.inventoryPaths.workerSegmentInventory,
        "workerSegmentInventory"
      ),
      campaignRegistry: this.readJsonArray(
        this.inventoryPaths.campaignRegistry,
        "campaignRegistry"
      ),
      leadUploadQueue: this.readJsonArray(
        this.inventoryPaths.leadUploadQueue,
        "leadUploadQueue"
      )
    };
    const workerRegistry = this.inspectWorkerRegistry();
    const credentials = {
      instantlyApiKeyPresent: String(this.env.INSTANTLY_API_KEY || "").trim().length > 10,
      valuesExposed: false
    };
    const liveConnector = await this.inspectLiveConnector(input.live === true);
    const blockers = [];
    contracts.filter(item => !item.ok).forEach(item => blockers.push(`SOURCE_CONTRACT:${item.id}`));
    if (!credentials.instantlyApiKeyPresent) blockers.push("MISSING_INSTANTLY_API_KEY");
    if (!workerRegistry.ok) blockers.push("INSTANTLY_WORKER_NOT_REGISTERED");
    Object.values(inventories).filter(item => !item.ok).forEach(item => blockers.push(`INVENTORY:${item.label}`));
    if (input.live === true && liveConnector.ok !== true) blockers.push("INSTANTLY_LIVE_HEALTH_FAILED");

    const sourceContractsHealthy = contracts.every(item => item.ok);
    const inventoryContractsHealthy = Object.values(inventories).every(item => item.ok);
    const audit = {
      ok: true,
      service: this.service,
      mode: input.apply === true ? "APPLY" : "PLAN_ONLY",
      status: blockers.length === 0 ? "READY" : "BLOCKED",
      generatedAt: this.generatedAt(),
      sourceContractsHealthy,
      inventoryContractsHealthy,
      credentials,
      workerRegistry,
      liveConnector,
      contracts,
      inventories,
      blockers: [...new Set(blockers)].sort(),
      revenueBootstrapReady: blockers.length === 0,
      operationalWritesAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsChanged: false
    };
    const fingerprintBody = { ...audit };
    delete fingerprintBody.generatedAt;
    audit.auditFingerprint = sha256(
      Buffer.from(JSON.stringify(fingerprintBody), "utf8")
    );
    if (input.apply === true) {
      fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
      const temporary = `${this.outputPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(audit, null, 2), "utf8");
      fs.renameSync(temporary, this.outputPath);
      audit.artifact = {
        filePath: this.outputPath,
        bytes: fs.statSync(this.outputPath).size,
        sha256: sha256(fs.readFileSync(this.outputPath))
      };
    }
    return audit;
  }
}

module.exports = RevenueOperationsBootstrapAuditService;
module.exports.RevenueOperationsBootstrapAuditService = RevenueOperationsBootstrapAuditService;
module.exports.sha256 = sha256;

