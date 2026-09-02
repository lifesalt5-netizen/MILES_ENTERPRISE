"use strict";

const service = require("../SERVICES/revenue/RevenueUniverseReconciliationService");
const Fy2026AwardedUniverseCoverageService = require("../SERVICES/revenue/Fy2026AwardedUniverseCoverageService");
const CanonicalAwardedContractorMasterService = require("../SERVICES/revenue/CanonicalAwardedContractorMasterService");

const objective = [
  "Reconcile the full ORION contractor universe into the P2GC revenue lifecycle.",
  "Treat the current governed contact master as one outbound subset, not the total addressable market or canonical company master.",
  "For every contractor produce an evidence-backed commercial disposition and next-action state.",
  "Companies with stale or missing contacts must remain visible for qualification or enrichment rather than disappearing.",
  "Calculate the exact aligned FY2026 unique prime awardee universe, unique subcontract awardee universe, overlap across roles, and deduped union across either awarded role.",
  "Persist every exact awarded UEI into the canonical P2GC contractor master with PRIME, SUB, or BOTH role, award evidence, lifecycle state, and primary revenue segment.",
  "Retain a proven existing GSA, VA, SAM, certification, SBS, expiring, or SLED primary segment where available; otherwise assign a governed awarded-role/value fallback segment.",
  "Missing or stale contacts must enter verification or enrichment states, not cause the company to disappear.",
  "Only verified unsuppressed contacts may appear in outbound-ready segment exports.",
  "Do not send email, activate campaigns, mutate providers, override suppression, modify the current outbound master, or modify production ORION."
].join(" ");

async function main() {
  const result = await service.execute({
    source: "MILES_REMOTE_EXECUTION_BRIDGE",
    action: "REVENUE_UNIVERSE_RECONCILIATION",
    capability: "revenue.universe_reconciliation",
    provider: "MILES",
    connector: "MILES",
    objective,
    payload: {
      objective,
      activationPolicy: "CANONICAL_ACCOUNT_MASTER_BUILD_NO_AUTO_SEND_NO_SUPPRESSION_OVERRIDE"
    }
  });

  let awards = null;
  let canonical = null;
  if (result?.ok === true) {
    awards = await new Fy2026AwardedUniverseCoverageService().run();
    if (awards?.ok === true) {
      canonical = await new CanonicalAwardedContractorMasterService().run({ coverage: awards });
    }
  }

  const compact = {
    ok: result?.ok === true && awards?.ok === true && canonical?.ok === true,
    status: canonical?.status || result?.status || null,
    service: result?.service || null,
    mode: result?.mode || null,
    completedAt: result?.completedAt || null,
    universe: result?.universe || null,
    immediateAnswers: result?.immediateAnswers || null,
    awardedCoverage: awards ? {
      ok: awards.ok === true,
      status: awards.status || null,
      scope: awards.scope || null,
      currentMaster: awards.currentMaster || null,
      awardedUniverse: awards.awardedUniverse || null,
      sourceIntegrity: awards.sourceIntegrity || null,
      exactness: awards.exactness || null,
      safety: awards.safety || null,
      artifacts: awards.artifacts || null
    } : null,
    canonicalMaster: canonical ? {
      ok: canonical.ok === true,
      status: canonical.status || null,
      counts: canonical.counts || null,
      acceptance: canonical.acceptance || null,
      segmentManifest: canonical.segmentManifest || null,
      artifacts: canonical.artifacts || null,
      safety: canonical.safety || null
    } : null,
    acceptance: result?.acceptance || null,
    outputs: result?.outputs || null,
    safety: result?.safety || null,
    error: result?.error || awards?.error || canonical?.error || null
  };

  console.log("MILES_REVENUE_UNIVERSE_RECONCILIATION_COMPACT");
  console.log(JSON.stringify(compact, null, 2));
  if (compact.ok !== true) process.exitCode = 2;
}

main().catch(error => {
  console.error("MILES_REVENUE_UNIVERSE_RECONCILIATION_FAILED");
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
