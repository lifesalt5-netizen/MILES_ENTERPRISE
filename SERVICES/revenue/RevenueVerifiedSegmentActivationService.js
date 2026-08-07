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

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase(); }
function csv(value) { const text = String(value == null ? "" : value); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }

class RevenueVerifiedSegmentActivationService {
  constructor(options = {}) {
    this.service = "REVENUE_VERIFIED_SEGMENT_ACTIVATION";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.classificationRoot = options.classificationRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "lead_inventory_classification");
    this.resultsRoot = options.resultsRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results");
    this.existingPath = options.existingPath || path.join(this.classificationRoot, "verified_inventory.jsonl");
    this.existingManifestPath = options.existingManifestPath || path.join(this.classificationRoot, "manifest.json");
    this.newPath = options.newPath || path.join(this.resultsRoot, "verified_send_ready.jsonl");
    this.resultsManifestPath = options.resultsManifestPath || path.join(this.resultsRoot, "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_segment_activation");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  plan() {
    return { ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED", providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required manifest is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required inventory is missing: " + filePath);
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  primarySegment(segments) {
    const text = [...segments].join(" | ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return PRIORITIES.find(item => item.pattern.test(text)) || { rank: 9, name: "Unclassified" };
  }

  writeJsonl(name, records) {
    const filePath = path.join(this.outputRoot, name);
    const text = records.map(JSON.stringify).join("\n") + (records.length ? "\n" : "");
    fs.writeFileSync(filePath, text, "utf8");
    return { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
  }

  build(input = {}) {
    if (input.apply !== true) return this.plan();
    const existingManifest = this.loadJson(this.existingManifestPath);
    const resultsManifest = this.loadJson(this.resultsManifestPath);
    if (existingManifest.ok !== true || existingManifest.status !== "CLASSIFIED" || existingManifest.conservation?.ok !== true) throw new Error("Existing verified inventory evidence is unhealthy.");
    if (resultsManifest.ok !== true || resultsManifest.status !== "RECONCILED" || resultsManifest.conservation?.ok !== true || resultsManifest.exactBatchMatch?.ok !== true) throw new Error("New verification evidence is unhealthy.");
    const existing = this.loadJsonl(this.existingPath);
    const newlyVerified = this.loadJsonl(this.newPath);
    if (existing.length !== Number(existingManifest.summary.verified)) throw new Error("Existing verified count does not match its manifest.");
    if (newlyVerified.length !== Number(resultsManifest.summary.sendReady)) throw new Error("Newly verified count does not match its manifest.");

    const byEmail = new Map();
    const add = (record, source) => {
      const email = normalize(record.email);
      if (!email) throw new Error("Verified record is missing email.");
      if (!byEmail.has(email)) byEmail.set(email, { email, segments: new Set(), sources: new Set(), verificationSources: new Set(), evidence: [] });
      const merged = byEmail.get(email);
      for (const segment of (Array.isArray(record.segments) ? record.segments : [])) if (String(segment).trim()) merged.segments.add(String(segment).trim());
      merged.sources.add(source);
      merged.verificationSources.add(source === "GATE_6_EXISTING_VERIFIED" ? "PRIOR_VERIFIED_EVIDENCE" : "MILLIONVERIFIER_GATE_8");
      merged.evidence.push({ source, result: record.result || "ok", quality: record.quality || "good" });
    };
    existing.forEach(record => add(record, "GATE_6_EXISTING_VERIFIED"));
    newlyVerified.forEach(record => add(record, "MILLIONVERIFIER_GATE_8"));

    const master = [...byEmail.values()].map(record => {
      const primary = this.primarySegment(record.segments);
      return {
        email: record.email,
        primarySegment: primary.name,
        segmentPriority: primary.rank,
        segments: [...record.segments].sort(),
        sources: [...record.sources].sort(),
        verificationSources: [...record.verificationSources].sort(),
        disposition: "SEND_READY",
        evidence: record.evidence
      };
    }).sort((a, b) => a.segmentPriority - b.segmentPriority || a.email.localeCompare(b.email));

    const duplicateOverlap = existing.length + newlyVerified.length - master.length;
    const segments = {};
    for (const record of master) {
      if (!segments[record.primarySegment]) segments[record.primarySegment] = [];
      segments[record.primarySegment].push(record);
    }

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const artifacts = { master: this.writeJsonl("verified_segment_master.jsonl", master), segments: {} };
    for (const [name, records] of Object.entries(segments)) {
      const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const filePath = path.join(this.outputRoot, "segment_" + safeName + ".csv");
      const text = "email,primary_segment,segment_priority,all_segments\n" + records.map(record => [record.email, record.primarySegment, record.segmentPriority, record.segments.join(" | ")].map(csv).join(",")).join("\n") + (records.length ? "\n" : "");
      fs.writeFileSync(filePath, text, "utf8");
      artifacts.segments[name] = { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
    }

    const segmentCounts = Object.fromEntries(Object.entries(segments).map(([name, records]) => [name, records.length]));
    const manifest = {
      ok: true, service: this.service, mode: "APPLY", status: "ACTIVATION_INVENTORIES_PREPARED", generatedAt: this.generatedAt(),
      sourceEvidence: { existingClassificationFingerprint: existingManifest.classificationFingerprint, verificationReconciliationFingerprint: resultsManifest.reconciliationFingerprint },
      summary: { existingVerified: existing.length, newlyVerified: newlyVerified.length, inputOccurrences: existing.length + newlyVerified.length, duplicateOverlap, uniqueVerifiedLeads: master.length, segmentCounts },
      conservation: { ok: master.length + duplicateOverlap === existing.length + newlyVerified.length, uniqueVerifiedLeads: master.length, duplicateOverlap, inputOccurrences: existing.length + newlyVerified.length },
      onePrimarySegmentPerLead: master.every(record => record.primarySegment && Number.isInteger(record.segmentPriority)),
      providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false,
      artifacts
    };
    if (!manifest.conservation.ok || !manifest.onePrimarySegmentPerLead) throw new Error("Verified activation inventory validation failed.");
    const identity = { ...manifest }; delete identity.generatedAt;
    manifest.activationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    manifest.artifacts.manifest = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return manifest;
  }
}

module.exports = RevenueVerifiedSegmentActivationService;
module.exports.RevenueVerifiedSegmentActivationService = RevenueVerifiedSegmentActivationService;
module.exports.PRIORITIES = PRIORITIES;
