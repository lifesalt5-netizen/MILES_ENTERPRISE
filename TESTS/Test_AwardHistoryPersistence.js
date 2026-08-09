"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const AwardHistoryPersistenceService = require("../SERVICES/orion/AwardHistoryPersistenceService");

let passed = 0;
function assert(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`[PASS] ${label}`);
}

function authoritativeAudit(overrides = {}) {
  const base = {
    ok: true,
    service: "AWARD_HISTORY_TRUTH",
    status: "AUTHORITATIVE_AWARD_HISTORY_READ",
    generatedAt: "2026-08-09T01:06:36.974Z",
    source: {
      name: "USAspending.gov",
      identityAuthority: "SAM.gov",
      recipientMatchedBy: "SAM_UEI",
      authoritativeForPersistence: true,
      samIdentityStatus: "SAM_UEI_CONFIRMED"
    },
    identity: {
      uei: "TESTUEI12345",
      canonicalNames: ["TEST CONTRACTOR LLC"],
      reconciliationRequired: false
    },
    summary: {
      federalRevenue: 1500,
      awardCount: 2,
      primeAwardedRevenue: 1000,
      primeAwardCount: 1,
      subcontractedRevenue: 500,
      subcontractAwardCount: 1
    },
    primeAwards: [{
      role: "PRIME",
      awardId: "PRIME-1",
      recipientName: "TEST CONTRACTOR LLC",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      amount: 1000,
      description: "Prime test award",
      awardingAgency: "Agency A",
      awardingSubAgency: "Office A",
      fundingAgency: "Agency A",
      fundingSubAgency: "Office A",
      awardType: "Definitive Contract",
      source: "USAspending.gov"
    }],
    subcontracts: [{
      role: "SUBCONTRACT",
      primeAwardId: "PRIME-X",
      subawardId: "SUB-1",
      recipientName: "TEST CONTRACTOR LLC",
      recipientUei: "TESTUEI12345",
      actionDate: "2026-02-01",
      amount: 500,
      description: "Sub test award",
      awardingAgency: "Agency B",
      source: "USAspending.gov"
    }],
    persistence: {
      allowed: true,
      databaseWritesPerformed: false
    }
  };
  return { ...base, ...overrides };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "miles-award-persist-"));
const dbPath = path.join(tempDir, "orion-test.db");
const backupDir = path.join(tempDir, "backups");

const seed = new Database(dbPath);
seed.exec(`
  CREATE TABLE contractors (
    id INTEGER PRIMARY KEY,
    company TEXT,
    uei TEXT,
    federal_revenue REAL,
    award_count INTEGER
  );
  INSERT INTO contractors (id, company, uei, federal_revenue, award_count)
  VALUES (1, 'TEST CONTRACTOR LLC', 'TESTUEI12345', 999, 9);
`);
seed.close();

const service = new AwardHistoryPersistenceService({
  dbPath,
  backupDir,
  Database,
  now: () => new Date("2026-08-09T02:00:00.000Z")
});

const audit = authoritativeAudit();

const plan = service.plan(audit);
assert(plan.ok === true, "authoritative audit plans successfully");
assert(plan.status === "READY_FOR_AUTHORIZED_PERSISTENCE", "plan waits for explicit persistence authorization");
assert(plan.writesPerformed === false, "plan performs no writes");
assert(plan.summary.federalRevenue === 1500, "plan preserves governing federal revenue");
assert(plan.summary.awardCount === 2, "plan preserves governing award count");

const blockedFallback = service.plan(authoritativeAudit({
  status: "AWARD_HISTORY_READ_NAME_FALLBACK_REQUIRES_UEI_RECONCILIATION",
  source: { authoritativeForPersistence: false },
  identity: { uei: "TESTUEI12345", reconciliationRequired: true },
  persistence: { allowed: false }
}));
assert(blockedFallback.ok === false, "name fallback cannot persist");
assert(blockedFallback.blockers.includes("AUDIT_NOT_AUTHORITATIVE"), "non-authoritative audit blocker recorded");
assert(blockedFallback.blockers.includes("IDENTITY_RECONCILIATION_REQUIRED"), "identity reconciliation blocker recorded");

const badFormula = service.plan(authoritativeAudit({
  summary: {
    federalRevenue: 9999,
    awardCount: 2,
    primeAwardedRevenue: 1000,
    primeAwardCount: 1,
    subcontractedRevenue: 500,
    subcontractAwardCount: 1
  }
}));
assert(badFormula.ok === false, "bad revenue formula fails closed");
assert(badFormula.blockers.includes("FEDERAL_REVENUE_FORMULA_MISMATCH"), "revenue formula blocker recorded");

const noAuth = service.persist(audit, { live: true });
assert(noAuth.status === "AUTHORIZATION_REQUIRED", "write requires exact authorization");
assert(noAuth.writesPerformed === false, "missing authorization performs no writes");

const noLive = service.persist(audit, {
  authorization: AwardHistoryPersistenceService.AUTHORIZATION,
  live: false
});
assert(noLive.status === "LIVE_FLAG_REQUIRED", "write requires live flag");
assert(noLive.writesPerformed === false, "missing live flag performs no writes");

const beforeDb = new Database(dbPath, { readonly: true });
const before = beforeDb.prepare("SELECT federal_revenue, award_count FROM contractors WHERE id = 1").get();
beforeDb.close();
assert(before.federal_revenue === 999 && before.award_count === 9, "guard failures leave contractor totals unchanged");

const result = service.persist(audit, {
  authorization: AwardHistoryPersistenceService.AUTHORIZATION,
  live: true
});
assert(result.ok === true, "authorized persistence succeeds");
assert(result.status === "PERSISTED_AND_VERIFIED", "persistence verifies after write");
assert(result.writesPerformed === true, "authorized persistence records writes");
assert(result.verified === true, "post-write verification passes");
assert(fs.existsSync(result.backupPath), "pre-write database backup exists");
assert(result.ledger.primeRows === 1, "one prime award persisted");
assert(result.ledger.subcontractRows === 1, "one subcontract award persisted");
assert(result.ledger.primeRevenue === 1000, "prime revenue ledger matches truth");
assert(result.ledger.subcontractRevenue === 500, "subcontract revenue ledger matches truth");

let verify = new Database(dbPath, { readonly: true });
let contractor = verify.prepare("SELECT federal_revenue, award_count FROM contractors WHERE id = 1").get();
assert(contractor.federal_revenue === 1500, "contractor federal revenue updated from prime plus subcontract history");
assert(contractor.award_count === 2, "contractor award count updated from distinct prime plus subcontract history");
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_prime WHERE contractor_id = 1").get().c === 1, "prime ledger table contains authoritative award");
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_subcontracts WHERE contractor_id = 1").get().c === 1, "subcontract ledger table contains authoritative award");
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_refresh_runs WHERE contractor_id = 1").get().c === 1, "refresh audit run recorded");
verify.close();

const replacementAudit = authoritativeAudit({
  summary: {
    federalRevenue: 2500,
    awardCount: 2,
    primeAwardedRevenue: 2000,
    primeAwardCount: 1,
    subcontractedRevenue: 500,
    subcontractAwardCount: 1
  },
  primeAwards: [{
    role: "PRIME",
    awardId: "PRIME-2",
    recipientName: "TEST CONTRACTOR LLC",
    amount: 2000,
    source: "USAspending.gov"
  }]
});
const replacement = service.persist(replacementAudit, {
  authorization: AwardHistoryPersistenceService.AUTHORIZATION,
  live: true
});
assert(replacement.ok === true, "refresh replacement succeeds");
verify = new Database(dbPath, { readonly: true });
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_prime WHERE contractor_id = 1").get().c === 1, "refresh replaces prime ledger instead of duplicating it");
assert(verify.prepare("SELECT award_id FROM award_history_prime WHERE contractor_id = 1").get().award_id === "PRIME-2", "refresh stores newest authoritative prime set");
contractor = verify.prepare("SELECT federal_revenue, award_count FROM contractors WHERE id = 1").get();
assert(contractor.federal_revenue === 2500 && contractor.award_count === 2, "refresh recalculates contractor totals atomically");
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_refresh_runs WHERE contractor_id = 1").get().c === 2, "each governed refresh is auditable");
verify.close();

const zeroAudit = authoritativeAudit({
  summary: {
    federalRevenue: 0,
    awardCount: 0,
    primeAwardedRevenue: 0,
    primeAwardCount: 0,
    subcontractedRevenue: 0,
    subcontractAwardCount: 0
  },
  primeAwards: [],
  subcontracts: []
});
const zeroResult = service.persist(zeroAudit, {
  authorization: AwardHistoryPersistenceService.AUTHORIZATION,
  live: true
});
assert(zeroResult.ok === true, "authoritatively confirmed zero award history can persist");
verify = new Database(dbPath, { readonly: true });
contractor = verify.prepare("SELECT federal_revenue, award_count FROM contractors WHERE id = 1").get();
assert(contractor.federal_revenue === 0 && contractor.award_count === 0, "authoritative zero history updates contractor totals to zero");
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_prime WHERE contractor_id = 1").get().c === 0, "zero refresh clears stale prime ledger");
assert(verify.prepare("SELECT COUNT(*) AS c FROM award_history_subcontracts WHERE contractor_id = 1").get().c === 0, "zero refresh clears stale subcontract ledger");
verify.close();

console.log(`ORION_AWARD_HISTORY_PERSISTENCE_TEST_PASS ${passed}/${passed}`);
