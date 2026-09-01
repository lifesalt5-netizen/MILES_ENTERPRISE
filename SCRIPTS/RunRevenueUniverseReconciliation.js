"use strict";

const service = require("../SERVICES/revenue/RevenueUniverseReconciliationService");
const awardedCoverage = require("../SERVICES/revenue/AwardedUniverseCoverageService");
const UsaspendingAwardHistoryStagingService = require("../SERVICES/UsaspendingAwardHistoryStagingService");

const objective = [
  "Reconcile the full ORION contractor universe into the P2GC revenue lifecycle.",
  "Treat the current governed master as one outbound subset, not the total addressable market.",
  "For every contractor produce an evidence-backed commercial disposition and next-action state.",
  "Companies with stale or missing contacts must remain visible for qualification or enrichment rather than disappearing.",
  "Return the defensible lower-bound count of commercially viable prospects, verified current decision-makers, contractors actually being contacted, market coverage, campaign-ready idle inventory, and the explicit unresolved qualification population.",
  "Also calculate the authoritative USAspending source-scope unique prime awardee universe, unique subcontract awardee universe, overlap across roles, deduped union across either awarded role, and how many awarded contractors are in versus missing from the current governed master.",
  "If the governed prime-plus-subaward staging manifest is missing, acquire it only from the official USAspending download API into staging and then retry the coverage calculation.",
  "Do not send email, activate campaigns, mutate providers, override suppression, or modify production ORION."
].join(" ");

async function resolveAwardedCoverage() {
  let awards = await awardedCoverage.run();
  if (awards?.status !== "USASPENDING_PRIME_SUBAWARD_MANIFEST_NOT_AVAILABLE") return awards;

  const staging = new UsaspendingAwardHistoryStagingService();
  const staged = await staging.refresh();
  if (staged?.ok !== true || staged?.status !== "COMPLETED") {
    return {
      ok: false,
      status: "USASPENDING_PRIME_SUBAWARD_STAGING_FAILED",
      staged
    };
  }
  awards = await awardedCoverage.run();
  return awards;
}

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
      activationPolicy: "STAGING_ONLY_NO_AUTO_SEND_NO_SUPPRESSION_OVERRIDE"
    }
  });

  let awards = null;
  if (result?.ok === true) awards = await resolveAwardedCoverage();

  const compact = {
    ok: result?.ok === true && awards?.ok === true,
    status: result?.status || null,
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
      sourceRows: awards.sourceRows || null,
      exactness: awards.exactness || null,
      safety: awards.safety || null,
      artifacts: awards.artifacts || null
    } : null,
    acceptance: result?.acceptance || null,
    outputs: result?.outputs || null,
    safety: result?.safety || null,
    error: result?.error || awards?.error || null
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
