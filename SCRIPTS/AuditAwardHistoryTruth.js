"use strict";

const fs = require("fs");
const path = require("path");

function loadRuntimeEnv() {
  const candidates = [
    process.env.MILES_ROOT ? path.join(process.env.MILES_ROOT, ".env") : null,
    path.join(process.cwd(), ".env")
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    try {
      require("dotenv").config({ path: envPath, override: false });
      return envPath;
    } catch {
      return null;
    }
  }
  return null;
}

loadRuntimeEnv();

const AwardHistoryTruthService = require("../SERVICES/orion/AwardHistoryTruthService");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const uei = arg("uei") || process.argv[2];
  const companyName = arg("name") || arg("company-name");
  if (!uei) {
    console.error("Usage: node SCRIPTS/AuditAwardHistoryTruth.js --uei <UEI> [--name <LEGAL COMPANY NAME>]");
    process.exitCode = 2;
    return;
  }

  try {
    const service = new AwardHistoryTruthService();
    const result = await service.auditByUei(uei, {
      companyName,
      pageSize: Number(arg("page-size")) || 100,
      maxPages: Number(arg("max-pages")) || 100
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(`AWARD_HISTORY_TRUTH_STATUS=${result.status}`);
    console.log(`SAM_IDENTITY_STATUS=${result.source?.samIdentityStatus || result.samIdentityStatus || "NOT_USED"}`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

main();
