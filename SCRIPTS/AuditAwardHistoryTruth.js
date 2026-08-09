"use strict";

const AwardHistoryTruthService = require("../SERVICES/orion/AwardHistoryTruthService");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const uei = arg("uei") || process.argv[2];
  if (!uei) {
    console.error("Usage: node SCRIPTS/AuditAwardHistoryTruth.js --uei <UEI>");
    process.exitCode = 2;
    return;
  }

  try {
    const service = new AwardHistoryTruthService();
    const result = await service.auditByUei(uei, {
      pageSize: Number(arg("page-size")) || 100,
      maxPages: Number(arg("max-pages")) || 100
    });
    console.log(JSON.stringify(result, null, 2));
    console.log(`AWARD_HISTORY_TRUTH_STATUS=${result.status}`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

main();
