"use strict";

const fs = require("fs");
const path = require("path");

const COLUMNS = Object.freeze([
  "Audience",
  "Eligible",
  "Company",
  "Contact",
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Title",
  "Meeting Date",
  "Prior Month",
  "Relationship Status",
  "Meeting Status",
  "CRM Status",
  "Prior Topic",
  "Source",
  "Source Seed",
  "Source Contact",
  "History Source File",
  "Evidence Type",
  "Evidence",
  "Blockers"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function keyFor(record = {}) {
  const email = clean(record.email).toLowerCase();
  if (email) return `EMAIL:${email}`;
  return `IDENTITY:${normalize(record.full_name || record.name)}|${normalize(record.company)}`;
}

function evidenceMap(localHistory = {}) {
  const map = new Map();
  for (const record of Array.isArray(localHistory.records) ? localHistory.records : []) {
    const key = keyFor(record);
    if (key === "IDENTITY:|") continue;
    const existing = map.get(key);
    const strength = Number(record.evidence_strength || 0);
    if (!existing || strength > Number(existing.evidence_strength || 0)) map.set(key, record);
  }
  return map;
}

function toRow(record = {}, audience, eligible, localEvidence = null) {
  return {
    "Audience": audience,
    "Eligible": eligible ? "YES" : "NO",
    "Company": clean(record.company || record.company_display),
    "Contact": clean(record.full_name || record.name || `${clean(record.first_name)} ${clean(record.last_name)}`),
    "First Name": clean(record.first_name),
    "Last Name": clean(record.last_name),
    "Email": clean(record.email),
    "Phone": clean(record.phone),
    "Title": clean(record.job_title || record.title),
    "Meeting Date": clean(record.meeting_date),
    "Prior Month": clean(record.prior_month),
    "Relationship Status": clean(record.relationship_status),
    "Meeting Status": clean(record.meeting_status),
    "CRM Status": clean(record.crm_status),
    "Prior Topic": clean(record.prior_topic),
    "Source": clean(record.source),
    "Source Seed": clean(record.source_seed),
    "Source Contact": clean(record.source_contact),
    "History Source File": clean(localEvidence?.source_file),
    "Evidence Type": clean(localEvidence?.evidence_type),
    "Evidence": clean(localEvidence?.source_evidence),
    "Blockers": Array.isArray(record.blockers)
      ? record.blockers.join(" | ")
      : clean(record.blockers || localEvidence?.review_required)
  };
}

class WinBackMasterExportService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.outputDir = options.outputDir || path.join(this.rootDir, "DATA", "runtime", "revenue", "winback");
    this.masterPath = options.masterPath || path.join(this.outputDir, "WINBACK_MASTER_LATEST.csv");
    this.priorReadyPath = options.priorReadyPath || path.join(this.outputDir, "WINBACK_READY_PRIOR_CONVERSATIONS.csv");
    this.reactivationReadyPath = options.reactivationReadyPath || path.join(this.outputDir, "WINBACK_READY_REACTIVATION.csv");
    this.reviewPath = options.reviewPath || path.join(this.outputDir, "WINBACK_REVIEW_QUEUE.csv");
    this.summaryPath = options.summaryPath || path.join(this.outputDir, "winback_master_export_latest.json");
  }

  writeCsv(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lines = [COLUMNS.map(csvEscape).join(",")];
    for (const row of rows) lines.push(COLUMNS.map(column => csvEscape(row[column])).join(","));
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${lines.join("\r\n")}\r\n`, "utf8");
    fs.renameSync(temporary, filePath);
  }

  writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  }

  execute(input = {}) {
    const reconstruction = input.reconstruction || {};
    const localHistory = input.localHistory || {};
    const localMap = evidenceMap(localHistory);

    const priorRows = (reconstruction.priorConversationCandidates || []).map(record =>
      toRow(record, "PRIOR_CONVERSATION", true, localMap.get(keyFor(record)))
    );
    const reactivationRows = (reconstruction.reactivationCandidates || []).map(record =>
      toRow(record, "REACTIVATION", true, localMap.get(keyFor(record)))
    );
    const reviewRows = (reconstruction.blocked || []).map(record =>
      toRow(record, "REVIEW", false, localMap.get(keyFor(record)))
    );

    const masterRows = [...priorRows, ...reactivationRows, ...reviewRows]
      .sort((a, b) => {
        if (a.Eligible !== b.Eligible) return a.Eligible === "YES" ? -1 : 1;
        const company = a.Company.localeCompare(b.Company);
        if (company !== 0) return company;
        return a.Contact.localeCompare(b.Contact);
      });

    this.writeCsv(this.masterPath, masterRows);
    this.writeCsv(this.priorReadyPath, priorRows);
    this.writeCsv(this.reactivationReadyPath, reactivationRows);
    this.writeCsv(this.reviewPath, reviewRows);

    const summary = {
      ok: true,
      service: "WINBACK_MASTER_EXPORT",
      generatedAt: new Date().toISOString(),
      masterCount: masterRows.length,
      priorReadyCount: priorRows.length,
      reactivationReadyCount: reactivationRows.length,
      reviewCount: reviewRows.length,
      evidenceEnrichedCount: masterRows.filter(row => clean(row["Evidence Type"])).length,
      files: {
        master: this.masterPath,
        priorReady: this.priorReadyPath,
        reactivationReady: this.reactivationReadyPath,
        review: this.reviewPath,
        summary: this.summaryPath
      },
      rules: {
        rawMailingListsExcludedUnlessRelationshipEvidenceExists: true,
        readyFilesContainEligibleRecordsOnly: true,
        reviewFileContainsBlockedOrUnverifiedRecords: true
      }
    };
    this.writeJson(this.summaryPath, summary);
    return summary;
  }
}

module.exports = WinBackMasterExportService;
module.exports.WinBackMasterExportService = WinBackMasterExportService;
module.exports.COLUMNS = COLUMNS;
module.exports.helpers = { clean, normalize, csvEscape, keyFor, evidenceMap, toRow };
