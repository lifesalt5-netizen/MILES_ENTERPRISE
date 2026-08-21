"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function clean(value) { return String(value == null ? "" : value).trim(); }
function normalize(value) { return clean(value).replace(/^\uFEFF/, "").toLowerCase(); }
function normalizeUei(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function normalizeName(value) {
  return clean(value).toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bDBA\b.*$/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(LLC|INC|CORP|CORPORATION|LTD|LP|LLP|CO|COMPANY|PLLC|PC)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}
function validEmail(value) { return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(value)); }

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value); value = "";
      if (row.some(cell => clean(cell))) rows.push(row);
      row = [];
    } else value += c;
  }
  if (value || row.length) { row.push(value); if (row.some(cell => clean(cell))) rows.push(row); }
  return rows;
}

function splitValues(value) {
  return clean(value).split(/[;|]/).map(item => item.trim()).filter(Boolean);
}

const GROUP_LABELS = Object.freeze({
  EXPIRED_EVERYTHING: "Expired Everything",
  EXPIRING_6M: "Expiring 6 Months",
  EXPIRING_12M: "Expiring 12 Months",
  GSA: "GSA",
  VA: "VA",
  SAM: "SAM",
  CERTIFICATIONS: "Certifications",
  SBS: "SBS",
  SLED_STATE: "SLED State"
});

class GovernmentContractorTruthVerificationIntakeService {
  constructor(options = {}) {
    this.service = "GOVERNMENT_CONTRACTOR_TRUTH_VERIFICATION_INTAKE";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.intelligenceRoot = options.intelligenceRoot || process.env.P2GC_INTELLIGENCE_ROOT || "D:\\P2GC_Intelligence";
    this.truthRoot = options.truthRoot || path.join(this.intelligenceRoot, "GOVERNMENT_CONTRACTOR_TRUTH");
    this.masterPath = options.masterPath || path.join(this.truthRoot, "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V2.csv");
    this.recoveryDetailPath = options.recoveryDetailPath || path.join(this.truthRoot, "NEW_VEHICLE_CONTACT_RECOVERY_DETAIL_V2.csv");
    this.segmentModelPath = options.segmentModelPath || path.join(this.rootDir, "DATA", "registry", "OutboundRevenueSegmentModel.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "truth_contact_verification_intake");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      masterPath: this.masterPath,
      recoveryDetailPath: this.recoveryDetailPath,
      verificationRequired: true,
      externalVerificationRequested: false,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false,
      campaignsChanged: false
    };
  }

  loadCsv(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required truth CSV is missing: " + filePath);
    const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
    if (rows.length < 2) throw new Error("Truth CSV contains no data rows: " + filePath);
    const headers = rows[0].map(header => normalize(header));
    return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
  }

  loadSegmentModel() {
    if (!fs.existsSync(this.segmentModelPath)) throw new Error("Outbound revenue segment model is missing.");
    const model = JSON.parse(fs.readFileSync(this.segmentModelPath, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(model?.assignmentPolicy?.priorityOrder) || !Array.isArray(model?.segments)) {
      throw new Error("Outbound revenue segment model is unhealthy.");
    }
    return model;
  }

  groupForTruthSegment(segment) {
    const value = clean(segment).toUpperCase().replace(/[ -]+/g, "_");
    if (/^EXPIRED/.test(value)) return "EXPIRED_EVERYTHING";
    if (/EXPIRING.*6M|EXPIRING_6/.test(value)) return "EXPIRING_6M";
    if (/EXPIRING.*(12M|24M)|EXPIRING_(12|24)/.test(value)) return "EXPIRING_12M";
    if (/^GSA_/.test(value)) return "GSA";
    if (/^(VA|VA_FSS)_/.test(value)) return "VA";
    if (/^SAM_/.test(value)) return "SAM";
    if (/^(8A|8\(A\)|HUBZONE|WOSB|EDWOSB|SDVOSB|VOSB)_/.test(value)) return "CERTIFICATIONS";
    if (/^(SBS|NO_VEHICLE|NON_HOLDERS?)/.test(value)) return "SBS";
    if (/^(STATE_SLED|SLED_STATE)_/.test(value)) return "SLED_STATE";
    return null;
  }

  outboundOwnership(masterRow, model) {
    const truthSegments = splitValues(masterRow.segments);
    const groups = new Set(truthSegments.map(segment => this.groupForTruthSegment(segment)).filter(Boolean));
    const priorityOrder = model.assignmentPolicy.priorityOrder;
    const ordered = priorityOrder.filter(group => groups.has(group));
    if (!ordered.length) {
      return { eligible: false, blocker: "NO_GOVERNED_OUTBOUND_SEGMENT", truthSegments, groups: [] };
    }
    const primaryGroup = ordered[0];
    return {
      eligible: true,
      primaryGroup,
      prioritySegment: GROUP_LABELS[primaryGroup] || primaryGroup,
      segmentPriority: priorityOrder.indexOf(primaryGroup) + 1,
      groups: ordered,
      truthSegments
    };
  }

  build(input = {}) {
    if (input.apply !== true) return this.plan();
    const model = this.loadSegmentModel();
    const master = this.loadCsv(this.masterPath);
    const recovered = this.loadCsv(this.recoveryDetailPath);

    const byUei = new Map();
    const byNameState = new Map();
    for (const row of master) {
      const uei = normalizeUei(row.uei);
      if (uei) {
        if (!byUei.has(uei)) byUei.set(uei, []);
        byUei.get(uei).push(row);
      }
      const key = normalizeName(row.legal_name) + "|" + clean(row.state).toUpperCase();
      if (key !== "|") {
        if (!byNameState.has(key)) byNameState.set(key, []);
        byNameState.get(key).push(row);
      }
    }

    const pendingByEmail = new Map();
    const held = [];
    let identityMatchedByUei = 0;
    let identityMatchedByNameState = 0;

    for (const row of recovered) {
      const email = normalize(row.email);
      if (!validEmail(email)) {
        held.push({ email, uei: normalizeUei(row.uei), legalName: row.legal_name, blocker: "INVALID_EMAIL_SYNTAX" });
        continue;
      }
      const uei = normalizeUei(row.uei);
      let matches = uei ? (byUei.get(uei) || []) : [];
      let identityMethod = "UEI";
      if (matches.length !== 1) {
        const key = normalizeName(row.legal_name) + "|" + clean(row.state).toUpperCase();
        matches = byNameState.get(key) || [];
        identityMethod = "NAME_STATE";
      }
      if (matches.length !== 1) {
        held.push({ email, uei, legalName: row.legal_name, blocker: "TRUTH_IDENTITY_NOT_UNIQUE", matchCount: matches.length });
        continue;
      }
      if (identityMethod === "UEI") identityMatchedByUei += 1;
      else identityMatchedByNameState += 1;

      const masterRow = matches[0];
      const ownership = this.outboundOwnership(masterRow, model);
      if (!ownership.eligible) {
        held.push({
          email,
          uei,
          legalName: row.legal_name || masterRow.legal_name,
          vehicleMemberships: splitValues(masterRow.vehicle_memberships),
          truthSegments: ownership.truthSegments,
          blocker: ownership.blocker
        });
        continue;
      }

      const candidate = {
        email,
        segments: [ownership.prioritySegment],
        truthSegments: ownership.truthSegments,
        truthVehicleMemberships: splitValues(masterRow.vehicle_memberships),
        sourceFamily: "GOVERNMENT_CONTRACTOR_TRUTH_RECOVERY",
        truthUei: uei || normalizeUei(masterRow.uei),
        legalName: row.legal_name || masterRow.legal_name,
        state: row.state || masterRow.state,
        contactSource: row.contact_source || null,
        contactMatchMethod: row.match_method || identityMethod,
        contactSourcePath: row.source_path || null,
        verificationRequired: true,
        classification: "PENDING_VERIFICATION"
      };

      const existing = pendingByEmail.get(email);
      if (!existing || ownership.segmentPriority < existing.segmentPriority) {
        pendingByEmail.set(email, { ...candidate, segmentPriority: ownership.segmentPriority });
      } else {
        existing.truthSegments = [...new Set([...existing.truthSegments, ...candidate.truthSegments])].sort();
        existing.truthVehicleMemberships = [...new Set([...existing.truthVehicleMemberships, ...candidate.truthVehicleMemberships])].sort();
      }
    }

    const pending = [...pendingByEmail.values()]
      .map(({ segmentPriority, ...record }) => record)
      .sort((a, b) => a.email.localeCompare(b.email));
    held.sort((a, b) => String(a.email).localeCompare(String(b.email)));

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const writeJsonl = (name, records) => {
      const filePath = path.join(this.outputRoot, name);
      const text = records.map(JSON.stringify).join("\n") + (records.length ? "\n" : "");
      fs.writeFileSync(filePath, text, "utf8");
      return { filePath, records: records.length, bytes: fs.statSync(filePath).size, sha256: sha256(fs.readFileSync(filePath)) };
    };
    const artifacts = {
      pending: writeJsonl("pending_verification.jsonl", pending),
      held: writeJsonl("held_without_outbound_ownership.jsonl", held)
    };
    const blockerCounts = {};
    for (const row of held) blockerCounts[row.blocker] = (blockerCounts[row.blocker] || 0) + 1;
    const manifest = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "TRUTH_CONTACT_VERIFICATION_INTAKE_PREPARED",
      generatedAt: this.generatedAt(),
      sourceEvidence: {
        masterPath: path.resolve(this.masterPath),
        masterSha256: sha256(fs.readFileSync(this.masterPath)),
        recoveryDetailPath: path.resolve(this.recoveryDetailPath),
        recoveryDetailSha256: sha256(fs.readFileSync(this.recoveryDetailPath)),
        segmentModelPath: path.resolve(this.segmentModelPath),
        segmentModelSha256: sha256(fs.readFileSync(this.segmentModelPath))
      },
      summary: {
        recoveredRows: recovered.length,
        verificationPending: pending.length,
        held: held.length,
        duplicateRecoveredEmails: recovered.length - pending.length - held.length,
        identityMatchedByUei,
        identityMatchedByNameState,
        blockerCounts
      },
      conservation: { ok: pending.length + held.length <= recovered.length, recoveredRows: recovered.length, pending: pending.length, held: held.length },
      verificationRequired: true,
      externalVerificationRequested: false,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false,
      campaignsChanged: false,
      artifacts
    };
    if (!manifest.conservation.ok) throw new Error("Truth verification intake conservation failed.");
    const identity = { ...manifest }; delete identity.generatedAt;
    manifest.intakeFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    const manifestPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    manifest.artifacts.manifest = { filePath: manifestPath, bytes: fs.statSync(manifestPath).size, sha256: sha256(fs.readFileSync(manifestPath)) };
    return manifest;
  }
}

module.exports = GovernmentContractorTruthVerificationIntakeService;
module.exports.GovernmentContractorTruthVerificationIntakeService = GovernmentContractorTruthVerificationIntakeService;
module.exports.parseCsv = parseCsv;
