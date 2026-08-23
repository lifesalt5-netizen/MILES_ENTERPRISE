"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const FederalPathwayScoreIntegratedService = require("./SERVICES/FederalPathwayScoreIntegratedService");

async function main() {
  const term = process.argv.slice(2).join(" ").trim() || String(process.env.P2GC_PATHWAY_SCORE_TERM || "").trim();
  if (!term) {
    console.error("Usage: node RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js <company name or UEI>");
    process.exit(2);
  }

  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  const service = new FederalPathwayScoreIntegratedService();
  const result = await service.evaluate(term);
  const evidence = {
    ok: result?.ok === true,
    service: "P2GC_FEDERAL_PATHWAY_SCORE_LIVE_RUNNER",
    generatedAt: new Date().toISOString(),
    term,
    result
  };
  const outDir = path.join(rootDir, "DATA", "runtime", "revenue", "pathway_score");
  fs.mkdirSync(outDir, { recursive: true });
  evidence.outputFile = path.join(outDir, "live_latest.json");
  fs.writeFileSync(evidence.outputFile, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
