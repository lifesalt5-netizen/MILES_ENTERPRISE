"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SEGMENT_ALIASES = Object.freeze({
  "Expired Everything": ["expired everything"],
  "Expiring 6 Months": ["expiring 6 months", "expiring 6m"],
  "Expiring 12 Months": ["expiring 12 months", "expiring 12m", "expiring gsa 12m", "expiring va 12m"],
  "GSA No Sales": ["gsa no sales"],
  "GSA Revenue": ["gsa revenue", "gsa low sales", "gsa growth", "gsa above"],
  "VA Revenue": ["va revenue", "va no sales", "va low sales", "va growth", "va above"],
  SAM: ["sam", "sam no sales", "sam low sales", "sam growth"],
  "8(a)": ["8a", "8 a"],
  HUBZone: ["hubzone"],
  SDVOSB: ["sdvosb"],
  VOSB: ["vosb"],
  WOSB: ["wosb"],
  SBS: ["sbs", "small business search"],
  Experimental: ["experimental"]
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractArray(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

class RevenueSegmentReadinessService {
  constructor(options = {}) {
    this.service = "REVENUE_SEGMENT_READINESS";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.inventoryPath = options.inventoryPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "revenue_inventory_sync.json");
    this.outputPath = options.outputPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_readiness_reconciliation.json");
    this.sourceRoots = options.sourceRoots || [
      path.join(this.rootDir, "DATA", "OUTBOUND"),
      path.join(this.rootDir, "DATA", "staging", "government_data"),
      path.join(path.dirname(this.rootDir), "ARCHIVE_2026_REVIEW", "Good Files to use", "Good To Use and segmented")
    ];
    this.inventoryProvider = options.inventoryProvider || (() => JSON.parse(fs.readFileSync(this.inventoryPath, "utf8").replace(/^\uFEFF/, "")));
    this.sourceProvider = options.sourceProvider || (() => this.discoverSources());
    this.mailboxProvider = options.mailboxProvider || (() => this.loadMailboxes());
  }

  plan(input = {}) {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      liveMailboxReadRequested: input.live === true,
      intendedWrites: [this.outputPath],
      externalMutationsAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsChanged: false
    };
  }

  walkCsv(root, results = []) {
    if (!fs.existsSync(root)) return results;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile() && /\.csv$/i.test(entry.name)) results.push(full);
      }
    }
    return results;
  }

  aliasesFor(segmentName) {
    return unique([normalize(segmentName), ...(SEGMENT_ALIASES[segmentName] || []).map(normalize)]);
  }

  sourceMatches(filePath, segmentName) {
    const name = normalize(path.basename(filePath, path.extname(filePath)));
    return this.aliasesFor(segmentName).some(alias => name === alias || name.startsWith(`${alias} `));
  }

  inspectCsv(filePath) {
    const stat = fs.statSync(filePath);
    const sample = fs.readFileSync(filePath, { encoding: "utf8", flag: "r" });
    const lines = sample.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    const header = (lines[0] || "").toLowerCase();
    const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
    const filenameVerified = /(verified|validated|millionverifier|ok.only)/i.test(path.basename(filePath));
    const statusHeader = /(verification|email.status|millionverifier|result)/i.test(header);
    const emails = new Set();
    for (const line of lines.slice(1)) {
      const explicitGood = filenameVerified || (statusHeader && /(^|[,;|\t\"])(ok|valid|verified|deliverable)([,;|\t\"]|$)/i.test(line));
      if (!explicitGood) continue;
      for (const email of line.match(emailPattern) || []) emails.add(email.toLowerCase());
    }
    return {
      filePath,
      exists: true,
      bytes: stat.size,
      rows: Math.max(0, lines.length - 1),
      verifiedEmailCount: emails.size,
      verificationEvidence: filenameVerified ? "VERIFIED_FILENAME" : statusHeader ? "EXPLICIT_STATUS_COLUMN" : "NONE"
    };
  }

  discoverSources() {
    const segmentNames = Object.keys(SEGMENT_ALIASES);
    return unique(this.sourceRoots.flatMap(root => this.walkCsv(root)))
      .filter(filePath => segmentNames.some(segmentName => this.sourceMatches(filePath, segmentName)))
      .map(filePath => this.inspectCsv(filePath));
  }

  async loadMailboxes() {
    const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
    const mailboxes = [];
    let startingAfter = null;
    for (let page = 0; page < 100; page += 1) {
      const response = await instantly.listAccounts({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      mailboxes.push(...extractArray(response, ["items", "accounts", "data", "results"]));
      startingAfter = response?.next_starting_after || response?.nextStartingAfter || null;
      if (!startingAfter) break;
    }
    return mailboxes;
  }

  normalizeMailbox(item = {}) {
    const email = String(item.email || item.address || item.username || "").trim().toLowerCase();
    const status = String(item.status || item.state || "UNKNOWN").toUpperCase();
    return {
      email,
      domain: email.includes("@") ? email.split("@").pop() : null,
      status,
      usable: Boolean(email) && !["DISABLED", "ERROR", "DISCONNECTED", "PAUSED"].includes(status),
      evidence: item
    };
  }

  reconcileSegment(segment, sources, mailboxes) {
    const matches = sources.filter(source => this.sourceMatches(source.filePath, segment.segmentName));
    const verified = matches.filter(source => source.verifiedEmailCount > 0);
    const domain = String(segment.assignedDomain || "").toLowerCase();
    const domainMailboxes = mailboxes.filter(item => item.usable && item.domain === domain).map(item => item.email);
    const sourceFiles = matches.map(item => item.filePath);
    const verifiedEmailCount = Math.max(0, ...verified.map(item => item.verifiedEmailCount));
    const assignedInboxes = unique([...(segment.assignedInboxes || []), ...domainMailboxes]);
    const blockers = (segment.blockers || []).filter(blocker => {
      if (blocker === "SOURCE_FILE_NOT_MAPPED" && sourceFiles.length) return false;
      if (blocker === "NO_VERIFIED_EMAILS" && verifiedEmailCount > 0) return false;
      if (blocker === "INBOXES_NOT_ASSIGNED" && assignedInboxes.length) return false;
      return true;
    });
    return {
      ...segment,
      sourceFile: sourceFiles[0] || segment.sourceFile || null,
      sourceFiles,
      sourceEvidence: matches,
      verifiedEmailCount: Math.max(Number(segment.verifiedEmailCount || 0), verifiedEmailCount),
      assignedInboxes,
      blockers: unique(blockers).sort(),
      readinessStatus: blockers.length ? "BLOCKED" : "READY_FOR_GOVERNED_ACTIVATION",
      reconciledAt: this.generatedAt()
    };
  }

  writeAtomic(value) {
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    const temporary = `${this.outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, this.outputPath);
    return { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
  }

  async reconcile(input = {}) {
    if (input.apply !== true) return this.plan(input);
    if (input.live !== true) return { ...this.plan(input), mode: "APPLY", ok: false, status: "LIVE_READ_REQUIRED", blockers: ["EXPLICIT_LIVE_READ_REQUIRED"] };
    const inventory = await this.inventoryProvider();
    if (inventory?.ok !== true || inventory.status !== "SYNCHRONIZED" || !Array.isArray(inventory.segments)) throw new Error("Synchronized Gate 2 inventory is required.");
    const sources = await this.sourceProvider();
    const mailboxes = extractArray(await this.mailboxProvider(), ["items", "accounts", "data", "results"]).map(item => this.normalizeMailbox(item));
    const segments = inventory.segments.map(segment => this.reconcileSegment(segment, sources, mailboxes));
    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "RECONCILED",
      generatedAt: this.generatedAt(),
      summary: {
        segments: segments.length,
        sourcesDiscovered: sources.length,
        usableMailboxes: mailboxes.filter(item => item.usable).length,
        sourceMappedSegments: segments.filter(item => item.sourceFiles.length).length,
        verifiedEmailSegments: segments.filter(item => item.verifiedEmailCount > 0).length,
        mailboxAssignedSegments: segments.filter(item => item.assignedInboxes.length).length,
        readySegments: segments.filter(item => item.blockers.length === 0).length,
        blockedSegments: segments.filter(item => item.blockers.length > 0).length
      },
      segments,
      unresolved: segments.filter(item => item.blockers.length).map(item => ({ segmentName: item.segmentName, blockers: item.blockers })),
      externalMutationsAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsChanged: false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.reconciliationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    report.artifact = this.writeAtomic(report);
    return report;
  }
}

module.exports = RevenueSegmentReadinessService;
module.exports.RevenueSegmentReadinessService = RevenueSegmentReadinessService;
