"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WinBackMasterExportService = require("../SERVICES/revenue/WinBackMasterExportService");

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-winback-master-export-"));
  const outputDir = path.join(root, "DATA", "runtime", "revenue", "winback");
  const service = new WinBackMasterExportService({ rootDir: root, outputDir });

  const prior = {
    full_name: "Jane Smith",
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@acme.example",
    company: "Acme Federal",
    phone: "555-1000",
    job_title: "President",
    meeting_date: "2025-10-15",
    prior_month: "October 2025",
    relationship_status: "PRIOR_CONVERSATION",
    meeting_status: "COMPLETED",
    prior_topic: "GSA growth",
    source: "LOCAL_HISTORY_RECOVERY",
    source_seed: "local_history_seed.json",
    blockers: []
  };

  const reactivation = {
    full_name: "Nina NoShow",
    first_name: "Nina",
    email: "nina@noshow.example",
    company: "Nina Co",
    meeting_date: "2026-03-12",
    prior_month: "March 2026",
    relationship_status: "NO_SHOW",
    meeting_status: "NO_SHOW",
    source: "CALENDLY_WINBACK_RECONSTRUCTION",
    blockers: []
  };

  const blocked = {
    full_name: "Rick Reply",
    first_name: "Rick",
    email: "rick@reply.example",
    company: "Rick Co",
    meeting_date: "2026-02-20",
    prior_month: "February 2026",
    relationship_status: "STATUS_VALIDATION_REQUIRED",
    meeting_status: "STATUS_VALIDATION_REQUIRED",
    source: "LOCAL_HISTORY_RECOVERY",
    blockers: ["RELATIONSHIP_STATUS_VALIDATION_REQUIRED"]
  };

  const localHistory = {
    records: [
      {
        ...prior,
        source_file: "C:\\P2GC_Intelligence\\companies.xls.xlsx",
        evidence_type: "COMPLETED_CONVERSATION",
        evidence_strength: 5,
        source_evidence: "Spoke with Jane and pitched GSA growth support. Proposal sent after the call."
      },
      {
        ...blocked,
        source_file: "C:\\P2GC_Intelligence\\Master Contacts list NON GSA fromb12.csv",
        evidence_type: "ENGAGEMENT_ONLY",
        evidence_strength: 2,
        source_evidence: "Replied and interested in government contracting support.",
        review_required: "RELATIONSHIP_STATUS_VALIDATION_REQUIRED"
      }
    ]
  };

  const reconstruction = {
    priorConversationCandidates: [prior],
    reactivationCandidates: [reactivation],
    blocked: [blocked]
  };

  const report = service.execute({ reconstruction, localHistory });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.masterCount, 3);
  assert.strictEqual(report.priorReadyCount, 1);
  assert.strictEqual(report.reactivationReadyCount, 1);
  assert.strictEqual(report.reviewCount, 1);
  assert.strictEqual(report.evidenceEnrichedCount, 2);

  for (const filePath of Object.values(report.files)) {
    assert(fs.existsSync(filePath), `expected export file: ${filePath}`);
  }

  const master = fs.readFileSync(report.files.master, "utf8");
  const priorCsv = fs.readFileSync(report.files.priorReady, "utf8");
  const reactivationCsv = fs.readFileSync(report.files.reactivationReady, "utf8");
  const reviewCsv = fs.readFileSync(report.files.review, "utf8");

  assert(master.includes("Jane Smith") && master.includes("Nina NoShow") && master.includes("Rick Reply"), "master must contain all reconstructed records");
  assert(priorCsv.includes("Jane Smith"), "prior-ready CSV must contain confirmed prior conversation");
  assert(!priorCsv.includes("Rick Reply"), "prior-ready CSV must exclude blocked records");
  assert(reactivationCsv.includes("Nina NoShow"), "reactivation CSV must contain no-show record");
  assert(!reactivationCsv.includes("Jane Smith"), "reactivation CSV must exclude prior-conversation records");
  assert(reviewCsv.includes("Rick Reply"), "review CSV must contain blocked record");
  assert(reviewCsv.includes("RELATIONSHIP_STATUS_VALIDATION_REQUIRED"), "review CSV must disclose blocker");
  assert(master.includes("companies.xls.xlsx"), "master must preserve local history source file");
  assert(master.includes("COMPLETED_CONVERSATION"), "master must preserve evidence type");
  assert(master.includes("Spoke with Jane"), "master must preserve evidence excerpt");
  assert.strictEqual(report.rules.rawMailingListsExcludedUnlessRelationshipEvidenceExists, true);
  assert.strictEqual(report.rules.readyFilesContainEligibleRecordsOnly, true);

  fs.rmSync(root, { recursive: true, force: true });
  process.stdout.write("PASS winback_master_export_test\n");
}

run();
