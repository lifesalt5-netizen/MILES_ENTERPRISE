"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WinBackProspectReconstructionService = require("../SERVICES/revenue/WinBackProspectReconstructionService");

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-winback-reconstruction-"));
  const seedPath = path.join(root, "DATA", "revenue", "winback", "calendly_seed_20260818.json");
  const contactsPath = path.join(root, "HAS_EMAIL_READY_FOR_OUTREACH.csv");
  const indexPath = path.join(root, "SEGMENT_FILE_DISCOVERY.csv");

  write(seedPath, JSON.stringify({
    records: [
      { full_name: "Chokha Palayamkottai", first_name: "Chokha", meeting_date: "2026-03-18", meeting_status: "COMPLETED", relationship_status: "PRIOR_CONVERSATION" },
      { full_name: "Jonathan Evans", first_name: "Jonathan", meeting_date: "2026-03-04", meeting_status: "NO_SHOW", relationship_status: "NO_SHOW" },
      { full_name: "Jonathan Mullany", first_name: "Jonathan", email: "j.mullany@readytohelp.care", company: "Ready To Help", meeting_date: "2025-10-10", meeting_status: "MISSED_AND_RESCHEDULE_REQUESTED", relationship_status: "RESCHEDULED_UNCONFIRMED", source: "GOOGLE_CALENDAR_AND_GMAIL" },
      { full_name: "Zachary Winter", first_name: "Zachary", email: "zachary.winter@witsconsult.com", company: "WITS Consult", meeting_date: "2025-10-21", meeting_status: "SCHEDULED_ONLY", relationship_status: "STATUS_VALIDATION_REQUIRED", review_required: "Completion not verified" },
      { full_name: "Lisa Hodde", first_name: "Lisa", meeting_date: "2026-04-30", meeting_status: "COMPLETED", relationship_status: "PRIOR_CONVERSATION" },
      { full_name: "Kevin", first_name: "Kevin", meeting_date: "2026-06-05", meeting_status: "AMBIGUOUS", relationship_status: "AMBIGUOUS_EXCLUDED" },
      { full_name: "Jigar", first_name: "Jigar", meeting_date: "2026-03-25", meeting_status: "COMPLETED", relationship_status: "PRIOR_CONVERSATION" }
    ]
  }, null, 2));

  write(contactsPath, [
    "full_name,email,company,status,phone",
    "Chokha Palayamkottai,chokha@example.com,Integralops,,555-1000",
    "Jonathan Evans,jonathan@example.com,Evans Federal,,555-1001",
    "Lisa Hodde,lisa@example.com,Sera Example,CLIENT,555-1002",
    "Kevin Smith,kevin.smith@example.com,Smith Co,,555-1003",
    "Kevin Jones,kevin.jones@example.com,Jones Co,,555-1004",
    "Jigar Patel,jigar.patel@example.com,Patel Co,,555-1005",
    "Jigar Shah,jigar.shah@example.com,Shah Co,,555-1006"
  ].join("\n"));
  write(indexPath, `path\n${contactsPath}\n`);

  const service = new WinBackProspectReconstructionService({
    rootDir: root,
    env: {},
    seedPaths: [seedPath]
  });
  const report = service.execute({ writeReport: false });

  assert.strictEqual(report.priorConversationCount, 1, "completed prior conversation should be reconstructed");
  assert.strictEqual(report.priorConversationCandidates[0].email, "chokha@example.com");
  assert.strictEqual(report.priorConversationCandidates[0].track, "PRIOR_CONVERSATION");
  assert.strictEqual(report.reactivationCount, 2, "no-show plus direct-email reschedule should enter reactivation track");
  assert(report.reactivationCandidates.some(item => item.email === "jonathan@example.com"));

  const mullany = report.reactivationCandidates.find(item => item.email === "j.mullany@readytohelp.care");
  assert(mullany, "direct verified Calendar/Gmail email should be accepted without a local contact-file match");
  assert.strictEqual(mullany.direct_seed_email, true);
  assert.strictEqual(mullany.company, "Ready To Help");
  assert.strictEqual(mullany.source, "GOOGLE_CALENDAR_AND_GMAIL");

  const zachary = report.blocked.find(item => item.full_name === "Zachary Winter");
  assert(zachary, "scheduled-only record must remain blocked even with a direct valid email");
  assert(zachary.blockers.includes("RELATIONSHIP_STATUS_VALIDATION_REQUIRED"));
  assert(zachary.blockers.includes("MANUAL_REVIEW_REQUIRED"));
  assert(!zachary.blockers.includes("CONTACT_MATCH_REQUIRED"), "direct email should remove contact-match dependency");

  const lisa = report.blocked.find(item => item.full_name === "Lisa Hodde");
  assert(lisa, "current client must be blocked");
  assert(lisa.blockers.some(item => item.startsWith("SUPPRESSED_STATUS:")), "client status suppression must be explicit");

  const kevin = report.blocked.find(item => item.full_name === "Kevin");
  assert(kevin, "ambiguous first-name-only Calendly record must be blocked");
  assert(kevin.blockers.includes("AMBIGUOUS_CALENDLY_RECORD"));

  const jigar = report.blocked.find(item => item.full_name === "Jigar");
  assert(jigar, "single-name record with multiple contact matches must fail closed");
  assert(jigar.blockers.includes("AMBIGUOUS_CONTACT_MATCH"));

  assert.strictEqual(report.rules.noShowCopyMayClaimPriorConversation, false);
  assert.strictEqual(report.rules.currentClientsSuppressed, true);
  assert.strictEqual(report.rules.ambiguousRecordsFailClosed, true);
  assert.strictEqual(report.rules.directVerifiedSeedEmailAccepted, true);
  assert.strictEqual(report.rules.scheduledOnlyRecordsRequireStatusValidation, true);

  fs.rmSync(root, { recursive: true, force: true });
  process.stdout.write("PASS winback_reconstruction_test\n");
}

run();
