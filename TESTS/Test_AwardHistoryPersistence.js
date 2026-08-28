"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const AwardHistoryPersistenceService = require("../SERVICES/orion/AwardHistoryPersistenceService");

function ok(condition, label) { if (!condition) throw new Error(label); console.log(`[PASS] ${label}`); }
function audit(overrides = {}) {
  const base = {
    ok:true,
    status:"AUTHORITATIVE_AWARD_HISTORY_READ",
    generatedAt:"2026-08-28T00:00:00Z",
    source:{ authoritativeForPersistence:true, identityAuthority:"SAM.gov", recipientMatchedBy:"SAM_UEI" },
    identity:{ uei:"TESTUEI12345", reconciliationRequired:false },
    summary:{ federalRevenue:1500, awardCount:2, primeAwardedRevenue:1000, primeAwardCount:1, subcontractedRevenue:500, subcontractAwardCount:1 },
    primeAwards:[{ awardId:"P1", amount:1000, source:"USAspending.gov" }],
    subcontracts:[{ subawardId:"S1", primeAwardId:"P9", amount:500, source:"USAspending.gov" }],
    persistence:{ allowed:true }
  };
  return { ...base, ...overrides };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-persist-"));
const dbPath = path.join(dir, "orion.db");
const db = new Database(dbPath);
db.exec("CREATE TABLE contractors (id INTEGER PRIMARY KEY, company TEXT, uei TEXT, federal_revenue REAL, award_count INTEGER); INSERT INTO contractors VALUES (1,'TEST','TESTUEI12345',9,9);");
db.close();

const svc = new AwardHistoryPersistenceService({ dbPath, backupDir:path.join(dir,"backups"), Database, now:()=>new Date("2026-08-28T01:00:00Z") });
const plan = svc.plan(audit());
ok(plan.ok && plan.status === "READY_FOR_AUTHORIZED_PERSISTENCE", "authoritative plan is ready");
ok(plan.writesPerformed === false, "plan is read-only");

const bad = svc.plan(audit({ summary:{ federalRevenue:999, awardCount:2, primeAwardedRevenue:1000, primeAwardCount:1, subcontractedRevenue:500, subcontractAwardCount:1 } }));
ok(!bad.ok && bad.blockers.includes("FEDERAL_REVENUE_FORMULA_MISMATCH"), "bad formulas fail closed");

const noAuth = svc.persist(audit(), { live:true });
ok(noAuth.status === "AUTHORIZATION_REQUIRED" && !noAuth.writesPerformed, "exact authorization required");

const result = svc.persist(audit(), { authorization:AwardHistoryPersistenceService.AUTHORIZATION, live:true });
ok(result.ok && result.verified && result.status === "PERSISTED_AND_VERIFIED", "authorized persistence verifies");
ok(fs.existsSync(result.backupPath), "pre-write backup exists");

const verify = new Database(dbPath, { readonly:true });
const contractor = verify.prepare("SELECT federal_revenue, award_count FROM contractors WHERE id=1").get();
ok(contractor.federal_revenue === 1500 && contractor.award_count === 2, "contractor totals reconciled");
ok(verify.prepare("SELECT COUNT(*) c FROM award_history_prime").get().c === 1, "prime ledger persisted");
ok(verify.prepare("SELECT COUNT(*) c FROM award_history_subcontracts").get().c === 1, "subcontract ledger persisted");
ok(verify.prepare("SELECT COUNT(*) c FROM award_history_refresh_runs").get().c === 1, "refresh audit persisted");
verify.close();

console.log("ORION_AWARD_HISTORY_PERSISTENCE_TEST_PASS");
