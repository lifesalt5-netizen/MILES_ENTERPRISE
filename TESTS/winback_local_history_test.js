"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WinBackLocalHistoryDiscoveryService = require("../SERVICES/revenue/WinBackLocalHistoryDiscoveryService");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-winback-local-history-"));
  const appData = path.join(root, "AppData", "Roaming");
  const vault = path.join(root, "Documents", "P2GC Obsidian Vault");
  const p2gc = path.join(root, "P2GC_Intelligence");

  write(path.join(appData, "obsidian", "obsidian.json"), JSON.stringify({
    vaults: { one: { path: vault, ts: 1, open: true } }
  }));

  write(path.join(vault, "Prospects", "Acme Federal.md"), [
    "# Acme Federal",
    "Contact: Jane Smith",
    "Email: jane@acme.example",
    "Company: Acme Federal",
    "Date: 2025-10-15",
    "Topic: GSA growth and agency targeting",
    "Spoke with Jane and pitched the GSA growth support. Proposal sent after the call."
  ].join("\n"));

  write(path.join(vault, "Prospects", "Booked Only.md"), [
    "# Booked Only",
    "Contact: Bob Booked",
    "Email: bob@booked.example",
    "Company: Booked LLC",
    "Date: 2025-11-03",
    "Scheduled appointment after replying to B12 email."
  ].join("\n"));

  write(path.join(vault, "Prospects", "Too Old.md"), [
    "Contact: Old Prospect",
    "Email: old@example.com",
    "Company: Old LLC",
    "Date: 2025-08-15",
    "Spoke with Old Prospect and pitched services."
  ].join("\n"));

  write(path.join(p2gc, "Master Contacts list NON GSA fromb12.csv"), [
    "full_name,email,company,last_contact,notes",
    "Nina NoShow,nina@noshow.example,Nina Co,2026-03-12,No-show for federal strategy call",
    "Rick Reply,rick@reply.example,Rick Co,2026-02-20,Replied and interested in government contracting support"
  ].join("\n"));

  const xlsxPath = path.join(p2gc, "companies.xls.xlsx");
  write(xlsxPath, "fixture");

  const service = new WinBackLocalHistoryDiscoveryService({
    rootDir: root,
    homeDir: root,
    appData,
    platform: "linux",
    env: { WINBACK_HISTORY_ROOTS: [p2gc, vault].join(path.delimiter) },
    xlsxReader: filePath => {
      if (filePath !== xlsxPath) return { rows: [], error: null };
      return {
        rows: [
          {
            full_name: "Xavier Xlsx",
            email: "xavier@xlsx.example",
            company: "Xlsx Federal",
            meeting_date: "2026-01-22",
            notes: "Talked with Xavier about capture support and presented pricing"
          }
        ],
        error: null
      };
    }
  });

  const report = service.execute({ roots: [p2gc, vault], writeReport: false });

  assert(report.obsidianVaults.includes(vault), "Obsidian vault should be discovered from registry");
  assert(report.exactTargetFilesFound.some(item => item.endsWith("companies.xls.xlsx")), "known companies workbook should receive exact-target treatment");

  const jane = report.records.find(item => item.email === "jane@acme.example");
  assert(jane, "Obsidian prior conversation should be recovered");
  assert.strictEqual(jane.relationship_status, "PRIOR_CONVERSATION");
  assert.strictEqual(jane.review_required, "");

  const nina = report.records.find(item => item.email === "nina@noshow.example");
  assert(nina, "B12 no-show record should be recovered");
  assert.strictEqual(nina.relationship_status, "NO_SHOW");
  assert.strictEqual(nina.review_required, "");

  const xavier = report.records.find(item => item.email === "xavier@xlsx.example");
  assert(xavier, "XLSX row should be recoverable through the bounded reader interface");
  assert.strictEqual(xavier.relationship_status, "PRIOR_CONVERSATION");

  const bob = report.records.find(item => item.email === "bob@booked.example");
  assert(bob, "scheduled-only record should be retained for review");
  assert.strictEqual(bob.relationship_status, "STATUS_VALIDATION_REQUIRED");
  assert(bob.review_required.includes("RELATIONSHIP_STATUS_VALIDATION_REQUIRED"));

  const rick = report.records.find(item => item.email === "rick@reply.example");
  assert(rick, "reply-only B12 record should be retained for review");
  assert.strictEqual(rick.relationship_status, "STATUS_VALIDATION_REQUIRED");

  assert(!report.records.some(item => item.email === "old@example.com"), "records outside Sep 2025-May 2026 must be excluded");
  assert(report.confirmedPriorConversationCount >= 2, "confirmed conversations should be counted separately");
  assert(report.reactivationCount >= 1, "reactivation records should be counted separately");
  assert(report.reviewCount >= 2, "weak engagement should remain review-only");
  assert.strictEqual(report.safety.rawMailingListsAreNotAutomaticallyWinBackEligible, true);
  assert.strictEqual(report.safety.ambiguousRowsFailClosed, true);

  fs.rmSync(root, { recursive: true, force: true });
  process.stdout.write("PASS winback_local_history_test\n");
}

run();
