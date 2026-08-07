"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EMAIL_HEADERS = ["email", "email address", "contact email", "contact person's email", "contact person's email address", "business email"];
const STATUS_HEADERS = ["verification status", "email status", "millionverifier status", "result", "verification result", "email verification result"];
const SEGMENT_HEADERS = ["primary segment", "primarysegment", "segment", "segment name", "segment_name", "campaign"];
const GOOD = new Set(["ok", "valid", "verified", "deliverable"]);
const BAD = new Set(["invalid", "bad", "undeliverable", "do not mail", "do_not_mail", "disposable", "bounce", "bounced"]);
const LEAD_FILE_PATTERN = /(master|segment|gsa|sam|va|sbs|expired|expiring|hubzone|sdvosb|vosb|wosb|8a|8_a|millionverifier|validated|verified|email_ready)/i;
const VERIFIED_FILE_PATTERN = /(ok[_ -]?only|verified|validated[_ -]?email)/i;
const OPERATIONAL_FILE_PATTERN = /(inbox_status_master|campaign_status_master|domain_status_master|segment_inventory_master|segment_summary)/i;

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase(); }
function validEmail(value) { return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || "").trim()); }

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}

function headerIndex(headers, candidates) {
  const normalized = headers.map(normalize);
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

class RevenueLeadInventoryClassificationService {
  constructor(options = {}) {
    this.service = "REVENUE_LEAD_INVENTORY_CLASSIFICATION";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.sourceRoots = options.sourceRoots || [
      path.join(path.dirname(this.rootDir), "ARCHIVE_2026_REVIEW", "Good Files to use", "Good To Use and segmented"),
      path.join(this.rootDir, "DATA", "OUTBOUND")
    ];
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "lead_inventory_classification");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.fileReader = options.fileReader || (filePath => fs.readFileSync(filePath, "utf8"));
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      sourceRoots: this.sourceRoots,
      externalVerificationRequested: false,
      verificationCreditsUsed: 0,
      guessedEmailsAllowed: false,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false
    };
  }

  discoverFiles() {
    const files = [];
    for (const root of this.sourceRoots) {
      if (!fs.existsSync(root)) continue;
      const stack = [root];
      while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (
            entry.isFile() &&
            /\.csv$/i.test(entry.name) &&
            LEAD_FILE_PATTERN.test(entry.name) &&
            !OPERATIONAL_FILE_PATTERN.test(entry.name)
          ) files.push(full);
        }
      }
    }
    return [...new Set(files)].sort();
  }

  inspectFile(filePath) {
    const lines = this.fileReader(filePath).replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return { filePath, rows: 0, contacts: [], skipped: "NO_DATA_ROWS" };
    const headers = parseCsvLine(lines[0]);
    const emailIndex = headerIndex(headers, EMAIL_HEADERS);
    const statusIndex = headerIndex(headers, STATUS_HEADERS);
    const segmentIndex = headerIndex(headers, SEGMENT_HEADERS);
    if (emailIndex < 0) return { filePath, rows: lines.length - 1, contacts: [], skipped: "EMAIL_COLUMN_NOT_FOUND" };
    const verifiedFile = VERIFIED_FILE_PATTERN.test(path.basename(filePath));
    const contacts = [];
    let invalidEmailSyntax = 0;
    for (let index = 1; index < lines.length; index += 1) {
      const values = parseCsvLine(lines[index]);
      const email = normalize(values[emailIndex]);
      if (!email) continue;
      if (!validEmail(email)) { invalidEmailSyntax += 1; continue; }
      const rawStatus = statusIndex >= 0 ? normalize(values[statusIndex]).replace(/[_-]+/g, " ") : "";
      let evidenceStatus = "PENDING_VERIFICATION";
      let evidenceType = "NO_EXPLICIT_VERIFICATION";
      if (rawStatus && GOOD.has(rawStatus)) { evidenceStatus = "VERIFIED"; evidenceType = "EXPLICIT_GOOD_STATUS"; }
      else if (rawStatus && BAD.has(rawStatus)) { evidenceStatus = "INVALID"; evidenceType = "EXPLICIT_BAD_STATUS"; }
      else if (verifiedFile) { evidenceStatus = "VERIFIED"; evidenceType = "VERIFIED_SOURCE_FILE"; }
      const segment = String(values[segmentIndex] || path.basename(filePath, path.extname(filePath))).trim();
      contacts.push({ email, segment, sourceFile: filePath, sourceRow: index + 1, evidenceStatus, evidenceType, rawStatus: rawStatus || null });
    }
    return { filePath, rows: lines.length - 1, contacts, invalidEmailSyntax, verifiedFile, emailHeader: headers[emailIndex], statusHeader: statusIndex >= 0 ? headers[statusIndex] : null };
  }

  classify(fileResults) {
    const byEmail = new Map();
    for (const result of fileResults) {
      for (const contact of result.contacts) {
        if (!byEmail.has(contact.email)) byEmail.set(contact.email, { email: contact.email, verified: false, invalid: false, pending: false, segments: new Set(), sources: new Set(), evidence: [] });
        const record = byEmail.get(contact.email);
        record.verified ||= contact.evidenceStatus === "VERIFIED";
        record.invalid ||= contact.evidenceStatus === "INVALID";
        record.pending ||= contact.evidenceStatus === "PENDING_VERIFICATION";
        record.segments.add(contact.segment);
        record.sources.add(contact.sourceFile);
        record.evidence.push({ sourceFile: contact.sourceFile, sourceRow: contact.sourceRow, status: contact.evidenceStatus, type: contact.evidenceType, rawStatus: contact.rawStatus });
      }
    }
    const buckets = { verified: [], pending: [], invalid: [], conflicts: [] };
    for (const record of byEmail.values()) {
      const output = { email: record.email, segments: [...record.segments].sort(), sources: [...record.sources].sort(), evidence: record.evidence };
      if (record.verified && record.invalid) buckets.conflicts.push({ ...output, classification: "VERIFICATION_CONFLICT" });
      else if (record.verified) buckets.verified.push({ ...output, classification: "VERIFIED" });
      else if (record.invalid) buckets.invalid.push({ ...output, classification: "INVALID" });
      else buckets.pending.push({ ...output, classification: "PENDING_VERIFICATION" });
    }
    for (const records of Object.values(buckets)) records.sort((a, b) => a.email.localeCompare(b.email));
    return { uniqueEmails: byEmail.size, ...buckets };
  }

  writeJsonl(name, records) {
    const filePath = path.join(this.outputRoot, name);
    const text = records.map(record => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
    fs.writeFileSync(filePath, text, "utf8");
    return { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
  }

  classifyInventory(input = {}) {
    if (input.apply !== true) return this.plan();
    const files = this.discoverFiles();
    if (!files.length) throw new Error("No authoritative lead CSV files were discovered.");
    const results = files.map(filePath => this.inspectFile(filePath));
    const classified = this.classify(results);
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const artifacts = {
      verified: this.writeJsonl("verified_inventory.jsonl", classified.verified),
      pending: this.writeJsonl("pending_verification.jsonl", classified.pending),
      invalid: this.writeJsonl("invalid_inventory.jsonl", classified.invalid),
      conflicts: this.writeJsonl("verification_conflicts.jsonl", classified.conflicts)
    };
    const manifest = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "CLASSIFIED",
      generatedAt: this.generatedAt(),
      summary: {
        sourceFilesDiscovered: files.length,
        sourceFilesWithEmailColumns: results.filter(item => !item.skipped).length,
        sourceRows: results.reduce((sum, item) => sum + item.rows, 0),
        contactOccurrences: results.reduce((sum, item) => sum + item.contacts.length, 0),
        uniqueEmails: classified.uniqueEmails,
        verified: classified.verified.length,
        pendingVerification: classified.pending.length,
        invalid: classified.invalid.length,
        verificationConflicts: classified.conflicts.length,
        invalidEmailSyntax: results.reduce((sum, item) => sum + Number(item.invalidEmailSyntax || 0), 0)
      },
      sourceInventory: results.map(item => ({ filePath: item.filePath, rows: item.rows, contacts: item.contacts.length, invalidEmailSyntax: item.invalidEmailSyntax || 0, verifiedFile: item.verifiedFile || false, skipped: item.skipped || null })),
      externalVerificationRequested: false,
      verificationCreditsUsed: 0,
      guessedEmailsAllowed: false,
      guessedEmails: 0,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false,
      artifacts
    };
    const conservation = classified.verified.length + classified.pending.length + classified.invalid.length + classified.conflicts.length;
    manifest.conservation = { ok: conservation === classified.uniqueEmails, classified: conservation, uniqueEmails: classified.uniqueEmails };
    if (!manifest.conservation.ok) throw new Error("Lead classification conservation failed.");
    const identity = { ...manifest }; delete identity.generatedAt;
    manifest.classificationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    manifest.artifacts.manifest = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return manifest;
  }
}

module.exports = RevenueLeadInventoryClassificationService;
module.exports.RevenueLeadInventoryClassificationService = RevenueLeadInventoryClassificationService;
