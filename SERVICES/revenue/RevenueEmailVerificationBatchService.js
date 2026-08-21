"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRIORITIES = [
  { rank: 1, name: "Expired Everything", pattern: /expired everything/i },
  { rank: 2, name: "Expiring 6 Months", pattern: /expiring.*6|6.*month/i },
  { rank: 3, name: "Expiring 12 Months", pattern: /expiring.*12|12.*month/i },
  { rank: 4, name: "GSA", pattern: /\bgsa\b/i },
  { rank: 5, name: "VA", pattern: /\bva\b|veteran/i },
  { rank: 6, name: "SAM", pattern: /\bsam\b/i },
  { rank: 7, name: "Certifications", pattern: /8\(a\)|8a|hubzone|wosb|sdvosb|vosb|certification/i },
  { rank: 8, name: "SBS", pattern: /\bsbs\b/i }
];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function csv(value) {
  const text = String(value == null ? "" : value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }

class RevenueEmailVerificationBatchService {
  constructor(options = {}) {
    this.service = "REVENUE_EMAIL_VERIFICATION_BATCH";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.classificationRoot = options.classificationRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "lead_inventory_classification");
    this.pendingPath = options.pendingPath || path.join(this.classificationRoot, "pending_verification.jsonl");
    this.manifestPath = options.manifestPath || path.join(this.classificationRoot, "manifest.json");
    this.truthIntakeRoot = options.truthIntakeRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "truth_contact_verification_intake");
    this.truthPendingPath = options.truthPendingPath || path.join(this.truthIntakeRoot, "pending_verification.jsonl");
    this.truthManifestPath = options.truthManifestPath || path.join(this.truthIntakeRoot, "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_batch");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  plan(input = {}) {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      requestedCreditLimit: Number(input.creditLimit || 0),
      externalVerificationRequested: false,
      verificationCreditsUsed: 0,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false
    };
  }

  readJsonl(filePath) {
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  load() {
    if (!fs.existsSync(this.manifestPath)) throw new Error("Lead classification manifest is missing.");
    if (!fs.existsSync(this.pendingPath)) throw new Error("Pending verification inventory is missing.");
    const manifest = JSON.parse(fs.readFileSync(this.manifestPath, "utf8").replace(/^\uFEFF/, ""));
    if (manifest.ok !== true || manifest.status !== "CLASSIFIED" || manifest.conservation?.ok !== true) {
      throw new Error("Lead classification evidence is unhealthy.");
    }
    const canonical = this.readJsonl(this.pendingPath);
    if (canonical.length !== Number(manifest.summary.pendingVerification)) {
      throw new Error("Pending inventory count does not match classification manifest.");
    }

    const truthManifestExists = fs.existsSync(this.truthManifestPath);
    const truthPendingExists = fs.existsSync(this.truthPendingPath);
    if (truthManifestExists !== truthPendingExists) throw new Error("Truth verification intake is incomplete.");
    let truthManifest = null;
    let truth = [];
    if (truthManifestExists) {
      truthManifest = JSON.parse(fs.readFileSync(this.truthManifestPath, "utf8").replace(/^\uFEFF/, ""));
      if (
        truthManifest.ok !== true ||
        truthManifest.status !== "TRUTH_CONTACT_VERIFICATION_INTAKE_PREPARED" ||
        truthManifest.conservation?.ok !== true ||
        truthManifest.verificationRequired !== true
      ) throw new Error("Truth verification intake evidence is unhealthy.");
      truth = this.readJsonl(this.truthPendingPath);
      if (truth.length !== Number(truthManifest.summary.verificationPending)) {
        throw new Error("Truth pending inventory count does not match its manifest.");
      }
      if (truth.some(record => record.verificationRequired !== true || record.classification !== "PENDING_VERIFICATION")) {
        throw new Error("Truth intake contains a contact that is not verification-pending.");
      }
    }

    const byEmail = new Map();
    const add = (record, source) => {
      const email = normalizeEmail(record.email);
      if (!email) throw new Error("Pending verification record is missing email.");
      const existing = byEmail.get(email);
      if (!existing) {
        byEmail.set(email, {
          ...record,
          email,
          segments: [...new Set(Array.isArray(record.segments) ? record.segments : [])],
          intakeSources: [source]
        });
        return;
      }
      existing.segments = [...new Set([...(existing.segments || []), ...(Array.isArray(record.segments) ? record.segments : [])])].sort();
      existing.intakeSources = [...new Set([...(existing.intakeSources || []), source])].sort();
      for (const field of ["sourceFamily", "truthUei", "legalName", "state", "contactSource", "contactMatchMethod", "contactSourcePath"]) {
        if (!existing[field] && record[field]) existing[field] = record[field];
      }
      if (Array.isArray(record.truthSegments)) existing.truthSegments = [...new Set([...(existing.truthSegments || []), ...record.truthSegments])].sort();
      if (Array.isArray(record.truthVehicleMemberships)) existing.truthVehicleMemberships = [...new Set([...(existing.truthVehicleMemberships || []), ...record.truthVehicleMemberships])].sort();
    };
    canonical.forEach(record => add(record, "LEAD_CLASSIFICATION"));
    truth.forEach(record => add(record, "GOVERNMENT_CONTRACTOR_TRUTH_RECOVERY"));
    const records = [...byEmail.values()];
    return {
      manifest,
      truthManifest,
      records,
      sourceSummary: {
        canonicalPending: canonical.length,
        truthRecoveredPending: truth.length,
        duplicateOverlap: canonical.length + truth.length - records.length,
        uniquePending: records.length
      }
    };
  }

  priority(record) {
    const text = Array.isArray(record.segments) ? record.segments.join(" | ") : "";
    const normalizedText = text.replace(/[_\\-]+/g, " ").replace(/\\s+/g, " ").trim();
    const match = PRIORITIES.find(item => item.pattern.test(normalizedText));
    return match || { rank: 9, name: "Unclassified" };
  }

  build(input = {}) {
    if (input.apply !== true) return this.plan(input);
    const creditLimit = Number(input.creditLimit);
    if (!Number.isInteger(creditLimit) || creditLimit <= 0) {
      throw new Error("A positive integer --credit-limit is required.");
    }
    const { manifest, truthManifest, records, sourceSummary } = this.load();
    const prioritized = records.map(record => {
      const priority = this.priority(record);
      return { ...record, verificationPriority: priority.rank, prioritySegment: priority.name };
    }).sort((a, b) =>
      a.verificationPriority - b.verificationPriority ||
      a.email.localeCompare(b.email)
    );
    const batch = prioritized.slice(0, creditLimit);
    const deferred = prioritized.slice(creditLimit);
    const selectedByPriority = {};
    for (const record of batch) selectedByPriority[record.prioritySegment] = (selectedByPriority[record.prioritySegment] || 0) + 1;

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const batchPath = path.join(this.outputRoot, "millionverifier_batch.csv");
    const batchText = "email,verification_priority,priority_segment,segments,source_family,truth_uei\n" +
      batch.map(record => [
        record.email,
        record.verificationPriority,
        record.prioritySegment,
        (record.segments || []).join(" | "),
        record.sourceFamily || (record.intakeSources || []).join(" | "),
        record.truthUei || ""
      ].map(csv).join(",")).join("\n") +
      (batch.length ? "\n" : "");
    fs.writeFileSync(batchPath, batchText, "utf8");

    const deferredPath = path.join(this.outputRoot, "deferred_pending_verification.jsonl");
    const deferredText = deferred.map(record => JSON.stringify(record)).join("\n") + (deferred.length ? "\n" : "");
    fs.writeFileSync(deferredPath, deferredText, "utf8");

    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "BATCH_PREPARED",
      generatedAt: this.generatedAt(),
      sourceClassificationFingerprint: manifest.classificationFingerprint,
      sourceTruthIntakeFingerprint: truthManifest?.intakeFingerprint || null,
      summary: {
        pendingAvailable: records.length,
        canonicalPending: sourceSummary.canonicalPending,
        truthRecoveredPending: sourceSummary.truthRecoveredPending,
        duplicateOverlap: sourceSummary.duplicateOverlap,
        creditLimit,
        selectedForVerification: batch.length,
        deferred: deferred.length,
        selectedByPriority
      },
      conservation: {
        ok: batch.length + deferred.length === records.length,
        selected: batch.length,
        deferred: deferred.length,
        pendingAvailable: records.length
      },
      externalVerificationRequested: false,
      verificationCreditsUsed: 0,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false,
      artifacts: {
        batch: { filePath: batchPath, records: batch.length, bytes: fs.statSync(batchPath).size, sha256: sha256(fs.readFileSync(batchPath)) },
        deferred: { filePath: deferredPath, records: deferred.length, bytes: fs.statSync(deferredPath).size, sha256: sha256(fs.readFileSync(deferredPath)) }
      }
    };
    if (!report.conservation.ok) throw new Error("Verification batch conservation failed.");
    const identity = { ...report }; delete identity.generatedAt;
    report.batchFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const reportPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    report.artifacts.manifest = { filePath: reportPath, bytes: fs.statSync(reportPath).size, sha256: sha256(fs.readFileSync(reportPath)) };
    return report;
  }
}

module.exports = RevenueEmailVerificationBatchService;
module.exports.RevenueEmailVerificationBatchService = RevenueEmailVerificationBatchService;
module.exports.PRIORITIES = PRIORITIES;
