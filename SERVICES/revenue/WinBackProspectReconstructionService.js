"use strict";

const fs = require("fs");
const path = require("path");
const {
  CaptureCapacitySourceBootstrapService
} = require("./CaptureCapacitySourceBootstrapService");

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const COMPLETED_RELATIONSHIPS = new Set(["PRIOR_CONVERSATION", "COMPLETED"]);
const REACTIVATION_RELATIONSHIPS = new Set(["NO_SHOW", "RESCHEDULED_UNCONFIRMED"]);
const SUPPRESSED_STATUS_PATTERNS = [
  /\bCLIENT\b/i,
  /\bCUSTOMER\b/i,
  /ACTIVE[_ -]?CLIENT/i,
  /PAID[_ -]?CLIENT/i,
  /CURRENT[_ -]?CLIENT/i,
  /CLOSED[_ -]?WON/i,
  /\bWON\b/i,
  /UNSUBSCRIB/i,
  /DO[_ -]?NOT[_ -]?CONTACT/i,
  /\bDNC\b/i,
  /BOUNC/i,
  /NEGATIVE/i,
  /DISQUALIF/i
];
const ACTIVE_PIPELINE_PATTERNS = [
  /ACTIVE[_ -]?PROSPECT/i,
  /OPEN[_ -]?OPPORTUNITY/i,
  /MEETING[_ -]?BOOKED/i,
  /CALL[_ -]?SCHEDULED/i,
  /PROPOSAL[_ -]?(SENT|PENDING|OPEN)?/i,
  /\bENGAGED\b/i,
  /NEGOTIAT/i
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validEmail(value) {
  return /^\S+@\S+\.\S+$/.test(clean(value));
}

function first(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && clean(value)) return value;
  }
  return "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows.shift().map(clean);
  return rows
    .filter(candidate => candidate.some(value => clean(value)))
    .map(candidate => Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])));
}

function rowsFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of ["records", "rows", "results", "data", "prospects", "leads", "contacts", "candidates"]) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return parsed && typeof parsed === "object" ? [parsed] : [];
}

function readRows(filePath, maxBytes = DEFAULT_MAX_FILE_BYTES) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return [];
  if (stat.size > maxBytes) throw new Error(`FILE_TOO_LARGE:${stat.size}`);
  const extension = path.extname(filePath).toLowerCase();
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  if (extension === ".csv") return parseCsv(text);
  if (extension === ".json") return rowsFromJson(JSON.parse(text));
  if (extension === ".jsonl" || extension === ".ndjson") {
    return text.split(/\r?\n/).filter(line => clean(line)).map(line => JSON.parse(line));
  }
  return [];
}

function contactName(record = {}) {
  const direct = clean(first(record, [
    "full_name",
    "fullName",
    "name",
    "contact_name",
    "contactName",
    "primary_contact",
    "Primary Contact",
    "poc",
    "POC"
  ]));
  if (direct) return direct;
  const firstName = clean(first(record, ["first_name", "firstName", "First Name", "firstname"]));
  const lastName = clean(first(record, ["last_name", "lastName", "Last Name", "lastname"]));
  return clean(`${firstName} ${lastName}`);
}

function contactStatus(record = {}) {
  return clean(first(record, [
    "status",
    "lead_status",
    "crm_status",
    "stage",
    "Stage",
    "pipeline_stage",
    "contact_status",
    "relationship_status"
  ])).toUpperCase();
}

function recordEmail(record = {}) {
  return clean(first(record, ["email", "work_email", "contact_email", "Email", "email_address"]));
}

function recordCompany(record = {}) {
  return clean(first(record, [
    "company",
    "company_name",
    "companyName",
    "Company",
    "organization",
    "business_name",
    "legal_business_name",
    "vendor_name"
  ]));
}

function recordPhone(record = {}) {
  return clean(first(record, ["phone", "phone_number", "contact_phone", "Phone", "mobile"]));
}

function recordTitle(record = {}) {
  return clean(first(record, ["title", "job_title", "jobTitle", "position", "role"]));
}

function statusMatches(status, patterns) {
  return patterns.some(pattern => pattern.test(clean(status)));
}

function monthReference(dateValue) {
  const parsed = new Date(`${clean(dateValue)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "previously";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

class WinBackProspectReconstructionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.env = options.env || process.env;
    this.maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
    this.seedPaths = Array.isArray(options.seedPaths) && options.seedPaths.length
      ? options.seedPaths.map(item => path.resolve(item))
      : [path.join(this.rootDir, "DATA", "revenue", "winback", "calendly_seed_20260818.json")];
    this.outputPath = options.outputPath || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "winback",
      "prospect_reconstruction_latest.json"
    );
    this.sourceReportPath = options.sourceReportPath || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "winback",
      "contact_source_bootstrap_latest.json"
    );
  }

  loadSeeds() {
    const records = [];
    const errors = [];
    for (const seedPath of this.seedPaths) {
      try {
        if (!fs.existsSync(seedPath)) {
          errors.push({ seedPath, error: "FILE_NOT_FOUND" });
          continue;
        }
        for (const record of readRows(seedPath, this.maxFileBytes)) {
          records.push({ ...record, _seedPath: seedPath });
        }
      } catch (error) {
        errors.push({ seedPath, error: error.message });
      }
    }
    return { records, errors };
  }

  contactSources() {
    const explicit = clean(this.env.WINBACK_CONTACT_SOURCES)
      .split(path.delimiter)
      .map(clean)
      .filter(Boolean);
    if (explicit.length) {
      return {
        ok: true,
        status: "EXPLICIT_WINBACK_CONTACT_SOURCES",
        selectedSources: explicit,
        selectedCount: explicit.length,
        mode: "EXPLICIT"
      };
    }

    const isolatedEnv = { ...this.env };
    delete isolatedEnv.CAPTURE_CAPACITY_CONTACT_SOURCES;
    const bootstrap = new CaptureCapacitySourceBootstrapService({
      rootDir: this.rootDir,
      env: isolatedEnv,
      reportFile: this.sourceReportPath,
      maxSources: Number(this.env.WINBACK_MAX_CONTACT_SOURCES || 30),
      maxFileBytes: this.maxFileBytes
    });
    const report = bootstrap.apply();
    const selectedSources = (report.selectedSources || [])
      .map(item => typeof item === "string" ? item : item.filePath)
      .filter(Boolean);
    return { ...report, selectedSources };
  }

  loadContacts(sourcePaths = []) {
    const contacts = [];
    const errors = [];
    for (const sourcePath of sourcePaths) {
      try {
        for (const record of readRows(sourcePath, this.maxFileBytes)) {
          contacts.push({ record, _sourcePath: sourcePath });
        }
      } catch (error) {
        errors.push({ sourcePath, error: error.message });
      }
    }
    return { contacts, errors };
  }

  matchScore(seed = {}, contact = {}) {
    const seedName = normalize(seed.full_name || seed.name);
    const candidateName = normalize(contactName(contact));
    if (!seedName || !candidateName) return 0;
    if (seedName === candidateName) return 100;

    const seedTokens = seedName.split(" ").filter(Boolean);
    const candidateTokens = candidateName.split(" ").filter(Boolean);
    if (seedTokens.length === 1) {
      return candidateTokens[0] === seedTokens[0] ? 45 : 0;
    }

    const overlap = seedTokens.filter(token => candidateTokens.includes(token));
    if (overlap.length === seedTokens.length) return 80;
    if (overlap.length >= 2) return 60;
    return 0;
  }

  bestContactMatch(seed, wrappedContacts) {
    const scored = wrappedContacts
      .map(item => ({ ...item, score: this.matchScore(seed, item.record) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return { match: null, ambiguous: false, alternatives: [] };
    const topScore = scored[0].score;
    const top = scored.filter(item => item.score === topScore);

    const uniqueEmails = [...new Set(top.map(item => recordEmail(item.record).toLowerCase()).filter(Boolean))];
    if (topScore < 60 && top.length > 1) {
      return { match: null, ambiguous: true, alternatives: top.slice(0, 10) };
    }
    if (top.length > 1 && uniqueEmails.length > 1) {
      return { match: null, ambiguous: true, alternatives: top.slice(0, 10) };
    }
    return { match: top[0], ambiguous: false, alternatives: top.slice(1, 5) };
  }

  enrich(seed, matchResult) {
    const match = matchResult.match;
    const contact = match?.record || {};
    const relationshipStatus = clean(seed.relationship_status || seed.meeting_status).toUpperCase();
    const meetingStatus = clean(seed.meeting_status).toUpperCase();
    const status = contactStatus(contact);
    const email = recordEmail(contact);
    const blockers = [];

    if (clean(seed.review_required)) blockers.push("MANUAL_REVIEW_REQUIRED");
    if (relationshipStatus === "AMBIGUOUS_EXCLUDED" || meetingStatus === "AMBIGUOUS") {
      blockers.push("AMBIGUOUS_CALENDLY_RECORD");
    }
    if (!COMPLETED_RELATIONSHIPS.has(relationshipStatus) && !REACTIVATION_RELATIONSHIPS.has(relationshipStatus)) {
      blockers.push("RELATIONSHIP_STATUS_VALIDATION_REQUIRED");
    }
    if (matchResult.ambiguous) blockers.push("AMBIGUOUS_CONTACT_MATCH");
    if (!match) blockers.push("CONTACT_MATCH_REQUIRED");
    if (match && (!email || !validEmail(email))) blockers.push("VALID_EMAIL_REQUIRED");
    if (statusMatches(status, SUPPRESSED_STATUS_PATTERNS)) blockers.push(`SUPPRESSED_STATUS:${status}`);
    if (statusMatches(status, ACTIVE_PIPELINE_PATTERNS)) blockers.push(`ACTIVE_PIPELINE_REVIEW:${status}`);

    const company = recordCompany(contact) || clean(seed.company);
    const firstName = clean(seed.first_name) || clean(first(contact, ["first_name", "firstName", "First Name"])) || clean(contactName(contact).split(/\s+/)[0]);
    const fullName = clean(seed.full_name || seed.name) || contactName(contact);
    const track = COMPLETED_RELATIONSHIPS.has(relationshipStatus)
      ? "PRIOR_CONVERSATION"
      : REACTIVATION_RELATIONSHIPS.has(relationshipStatus)
        ? "REACTIVATION"
        : "BLOCKED";

    return {
      eligible: blockers.length === 0,
      track,
      first_name: firstName,
      last_name: clean(first(contact, ["last_name", "lastName", "Last Name"])),
      full_name: fullName,
      email,
      company,
      company_display: company || "your company",
      phone: recordPhone(contact),
      job_title: recordTitle(contact),
      crm_status: status,
      relationship_status: relationshipStatus,
      meeting_status: meetingStatus,
      meeting_date: clean(seed.meeting_date),
      prior_month: monthReference(seed.meeting_date),
      prior_topic: clean(seed.prior_topic || "your federal growth strategy"),
      meeting_type: clean(seed.meeting_type),
      calendly_selected_id: clean(seed.calendly_selected_id),
      source: "CALENDLY_WINBACK_RECONSTRUCTION",
      source_seed: seed._seedPath || "",
      source_contact: match?._sourcePath || "",
      match_score: Number(match?.score || 0),
      blockers: [...new Set(blockers)]
    };
  }

  dedupe(candidates = []) {
    const priority = { PRIOR_CONVERSATION: 3, REACTIVATION: 2, BLOCKED: 1 };
    const map = new Map();
    for (const candidate of candidates) {
      const key = candidate.email
        ? `EMAIL:${candidate.email.toLowerCase()}`
        : `NAME:${normalize(candidate.full_name)}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, candidate);
        continue;
      }
      const existingPriority = priority[existing.track] || 0;
      const candidatePriority = priority[candidate.track] || 0;
      const existingDate = Date.parse(existing.meeting_date || "") || 0;
      const candidateDate = Date.parse(candidate.meeting_date || "") || 0;
      if (candidatePriority > existingPriority || (candidatePriority === existingPriority && candidateDate > existingDate)) {
        map.set(key, candidate);
      }
    }
    return [...map.values()];
  }

  writeReport(report) {
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    const temp = `${this.outputPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2), "utf8");
    fs.renameSync(temp, this.outputPath);
    return this.outputPath;
  }

  execute(input = {}) {
    const seedResult = this.loadSeeds();
    const sourceReport = this.contactSources();
    const contactResult = this.loadContacts(sourceReport.selectedSources || []);
    const reconstructed = [];

    for (const seed of seedResult.records) {
      const matchResult = this.bestContactMatch(seed, contactResult.contacts);
      reconstructed.push(this.enrich(seed, matchResult));
    }

    const deduped = this.dedupe(reconstructed);
    const priorConversationCandidates = deduped.filter(item => item.eligible && item.track === "PRIOR_CONVERSATION");
    const reactivationCandidates = deduped.filter(item => item.eligible && item.track === "REACTIVATION");
    const blocked = deduped.filter(item => !item.eligible);

    const report = {
      ok: priorConversationCandidates.length > 0 || reactivationCandidates.length > 0,
      service: "WINBACK_PROSPECT_RECONSTRUCTION",
      status: priorConversationCandidates.length > 0 || reactivationCandidates.length > 0
        ? "WINBACK_CANDIDATES_READY"
        : "WINBACK_CONTACT_ENRICHMENT_REQUIRED",
      generatedAt: new Date().toISOString(),
      seedCount: seedResult.records.length,
      seedErrors: seedResult.errors,
      contactSourceStatus: sourceReport.status,
      contactSourceCount: (sourceReport.selectedSources || []).length,
      contactSourceErrors: contactResult.errors,
      contactRecordsScanned: contactResult.contacts.length,
      priorConversationCount: priorConversationCandidates.length,
      reactivationCount: reactivationCandidates.length,
      blockedCount: blocked.length,
      priorConversationCandidates,
      reactivationCandidates,
      blocked,
      rules: {
        completedRelationshipStatuses: [...COMPLETED_RELATIONSHIPS],
        reactivationRelationshipStatuses: [...REACTIVATION_RELATIONSHIPS],
        noShowCopyMayClaimPriorConversation: false,
        currentClientsSuppressed: true,
        activePipelineRequiresReview: true,
        ambiguousRecordsFailClosed: true
      }
    };

    if (input.writeReport !== false) report.artifact = this.writeReport(report);
    return report;
  }
}

module.exports = WinBackProspectReconstructionService;
module.exports.WinBackProspectReconstructionService = WinBackProspectReconstructionService;
module.exports.helpers = {
  clean,
  normalize,
  validEmail,
  parseCsv,
  readRows,
  contactName,
  contactStatus,
  recordEmail,
  recordCompany,
  statusMatches,
  monthReference,
  COMPLETED_RELATIONSHIPS,
  REACTIVATION_RELATIONSHIPS,
  SUPPRESSED_STATUS_PATTERNS,
  ACTIVE_PIPELINE_PATTERNS
};
