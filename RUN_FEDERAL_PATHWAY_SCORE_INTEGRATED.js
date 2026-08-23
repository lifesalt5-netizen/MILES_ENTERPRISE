"use strict";

require("dotenv").config();
const FederalPathwayScoreIntegratedService = require("./SERVICES/FederalPathwayScoreIntegratedService");

async function main() {
  const term = process.argv.slice(2).join(" ").trim() || String(process.env.P2GC_PATHWAY_SCORE_TERM || "").trim();
  if (!term) {
    console.error("Usage: node RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js <company name or UEI>");
    process.exit(2);
  }

  const service = new FederalPathwayScoreIntegratedService();
  const result = await service.evaluate(term);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
