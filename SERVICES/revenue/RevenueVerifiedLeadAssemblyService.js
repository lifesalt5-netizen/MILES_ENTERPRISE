"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EMAIL_HEADERS = ["email", "email address", "contact email", "contact person's email", "contact person's email address", "business email"];
const STATUS_HEADERS = ["verification status", "email status", "millionverifier status", "result", "verification result"];
const GOOD_STATUSES = new Set(["ok", "valid", "verified", "deliverable"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function normalize(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim()); value = "";
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function findHeader(headers, candidates) {
  const normalized = headers.map(normalize);
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function validEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || "").trim());
}

class RevenueVerifiedLeadAssemblyService {
  constructor(options = {}) {
    this.service = "REVENUE_VERIFIED_LEAD_ASSEMBLY";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.inputPath = options.inputPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_readiness_reconciliation.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_lead_assembly");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.inputProvider = options.inputProvider || (() => JSON.parse(fs.readFileSync(this.inputPath, "utf8").replace(/^\uFEFF/, "")));
    this.fileReader = options.fileReader || (filePath => fs.readFileSync(filePath, "utf8"));
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      intendedWrites: [
        path.join(this.outputRoot, "verified_leads_deduped.jsonl"),
        path.join(this.outputRoot, "duplicate_email_index.jsonl"),
        path.join(this.outputRoot, "manifest.json")
      ],
      guessedEmailsAllowed: false,
      providerWritesAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsChanged: false
    };
  }

  extractSource(segment, evidence) {
    const verificationEvidence = evidence.verificationEvidence || "NONE";
    if (verificationEvidence === "NONE" || Number(evidence.verifiedEmailCount || 0) <= 0) return [];
    if (!evidence.filePath || !fs.existsSync(evidence.filePath)) return [];
    const lines = this.fileReader(evidence.filePath).replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]);
    const emailIndex = findHeader(headers, EMAIL_HEADERS);
    const statusIndex = findHeader(headers, STATUS_HEADERS);
    if (emailIndex < 0) return [];
    const filenameVerified = verificationEvidence === "VERIFIED_FILENAME";
    const contacts = [];
    for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
      const values = parseCsvLine(lines[rowIndex]);
      const email = normalize(values[emailIndex]);
      const status = statusIndex >= 0 ? normalize(values[statusIndex]) : null;
      const explicitlyVerified = filenameVerified || (status && GOOD_STATUSES.has(status));
      if (!explicitlyVerified || !validEmail(email)) continue;
      const fields = {};
      headers.forEach((header, index) => { if (values[index] !== undefined && values[index] !== "") fields[header] = values[index]; });
      contacts.push({
        email,
        segmentName: segment.segmentName,
        segmentPriority: Number(segment.priority || 99),
        sourceFile: evidence.filePath,
        sourceRow: rowIndex + 1,
        verificationEvidence,
        verificationStatus: status || "VERIFIED_FILE",
        fields
      });
    }
    return contacts;
  }

  assembleContacts(readiness) {
    const contacts = readiness.segments.flatMap(segment =>
      (segment.sourceEvidence || []).flatMap(evidence => this.extractSource(segment, evidence))
    );
    const byEmail = new Map();
    const duplicates = [];
    for (const contact of contacts) {
      const existing = byEmail.get(contact.email);
      if (!existing) {
        byEmail.set(contact.email, {
          ...contact,
          primarySegment: contact.segmentName,
          segments: [contact.segmentName],
          sources: [contact.sourceFile]
        });
        continue;
      }
      duplicates.push({ email: contact.email, retainedSegment: existing.primarySegment, duplicateSegment: contact.segmentName, sourceFile: contact.sourceFile });
      existing.segments = [...new Set([...existing.segments, contact.segmentName])];
      existing.sources = [...new Set([...existing.sources, contact.sourceFile])];
      if (contact.segmentPriority < existing.segmentPriority) {
        existing.primarySegment = contact.segmentName;
        existing.segmentPriority = contact.segmentPriority;
      }
    }
    const leads = [...byEmail.values()].sort((left, right) => left.segmentPriority - right.segmentPriority || left.email.localeCompare(right.email));
    return { contactsRead: contacts.length, leads, duplicates };
  }

  writeJsonl(filePath, records) {
    const text = records.map(record => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
    fs.writeFileSync(filePath, text, "utf8");
    return { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
  }

  assemble(input = {}) {
    if (input.apply !== true) return this.plan();
    const readiness = this.inputProvider();
    if (readiness?.ok !== true || readiness.status !== "RECONCILED" || !Array.isArray(readiness.segments)) throw new Error("Healthy Gate 3 readiness evidence is required.");
    const assembled = this.assembleContacts(readiness);
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const leadArtifact = this.writeJsonl(path.join(this.outputRoot, "verified_leads_deduped.jsonl"), assembled.leads);
    const duplicateArtifact = this.writeJsonl(path.join(this.outputRoot, "duplicate_email_index.jsonl"), assembled.duplicates);
    const segmentCounts = {};
    for (const lead of assembled.leads) segmentCounts[lead.primarySegment] = (segmentCounts[lead.primarySegment] || 0) + 1;
    const manifest = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "ASSEMBLED",
      generatedAt: this.generatedAt(),
      inputFingerprint: readiness.reconciliationFingerprint || null,
      summary: {
        segmentsWithVerifiedSources: readiness.segments.filter(segment => (segment.sourceEvidence || []).some(item => item.verificationEvidence !== "NONE" && Number(item.verifiedEmailCount || 0) > 0)).length,
        contactsRead: assembled.contactsRead,
        uniqueVerifiedLeads: assembled.leads.length,
        duplicateRecords: assembled.duplicates.length,
        segmentCounts
      },
      guessedEmailsAllowed: false,
      guessedEmails: 0,
      providerWritesAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsChanged: false,
      artifacts: { leads: leadArtifact, duplicates: duplicateArtifact }
    };
    const identity = { ...manifest }; delete identity.generatedAt;
    manifest.assemblyFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    manifest.artifacts.manifest = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return manifest;
  }
}

module.exports = RevenueVerifiedLeadAssemblyService;
module.exports.RevenueVerifiedLeadAssemblyService = RevenueVerifiedLeadAssemblyService;
