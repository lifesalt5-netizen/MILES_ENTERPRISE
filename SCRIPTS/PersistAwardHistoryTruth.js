"use strict";

const path = require("path");
const fs = require("fs");

function loadRuntimeEnv() {
  const roots = [process.env.MILES_ROOT, process.cwd(), "C:\\P2GC_Intelligence\\MILES_ENTERPRISE", "D:\\P2GC_Intelligence\\MILES_ENTERPRISE"].filter(Boolean);
  for (const root of roots) {
    const envPath = path.join(root, ".env");
    if (!fs.existsSync(envPath)) continue;
    try { require("dotenv").config({ path: envPath, override: false }); return envPath; } catch { return null; }
  }
  return null;
}
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }

async function main() {
  loadRuntimeEnv();
  const AwardHistoryTruthService = require("../SERVICES/orion/AwardHistoryTruthService");
  const AwardHistoryPersistenceService = require("../SERVICES/orion/AwardHistoryPersistenceService");
  const uei = arg("--uei");
  const companyName = arg("--name") || "";
  const apply = process.argv.includes("--apply");
  const live = process.argv.includes("--live");
  const authorization = arg("--authorize") || "";
  if (!uei) throw new Error("--uei is required");

  const truth = new AwardHistoryTruthService();
  const audit = await truth.auditByUei(uei, { companyName });
  const persistence = new AwardHistoryPersistenceService();
  if (!apply) {
    const plan = persistence.plan(audit);
    console.log(JSON.stringify({ audit, persistencePlan: plan }, null, 2));
    console.log(`ORION_AWARD_HISTORY_PERSISTENCE_STATUS=${plan.status}`);
    return;
  }
  const result = persistence.persist(audit, { authorization, live });
  console.log(JSON.stringify({ audit, persistence: result }, null, 2));
  console.log(`ORION_AWARD_HISTORY_PERSISTENCE_STATUS=${result.status}`);
  if (!result.ok) process.exitCode = 2;
}

main().catch(error => { console.error(error.stack || error.message || error); process.exitCode = 1; });
