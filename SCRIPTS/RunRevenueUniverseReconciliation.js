"use strict";

const service = require("../SERVICES/revenue/RevenueUniverseReconciliationService");
const Fy2026AwardedUniverseCoverageService = require("../SERVICES/revenue/Fy2026AwardedUniverseCoverageService");
const CanonicalAwardedContractorMasterService = require("../SERVICES/revenue/CanonicalAwardedContractorMasterService");
const CanonicalContractorTaxonomyOverlayService = require("../SERVICES/revenue/CanonicalContractorTaxonomyOverlayService");
const AwardHistoryLocalInventoryService = require("../SERVICES/revenue/AwardHistoryLocalInventoryService");
const SixFiscalYearAwardSourceValidationService = require("../SERVICES/revenue/SixFiscalYearAwardSourceValidationService");
const B12HistoricalUniverseDiscoveryService = require("../SERVICES/revenue/B12HistoricalUniverseDiscoveryService");

const objective = [
  "Reconcile the full ORION contractor universe into the P2GC revenue lifecycle.",
  "Treat the current governed contact master as one outbound subset, not the total addressable market or canonical company master.",
  "Discover the Sep 2025-Feb 2026 B12 historical campaign/contact evidence from the governed Windows data estate before row reconstruction or migration-loss claims.",
  "Inventory existing local FY2021-FY2026 prime and subcontract award history before any reacquisition; Git repository absence is not evidence that Windows data is missing.",
  "Validate the actual local FY2021-FY2026 source files by fiscal year and award role before normalization; prefer exact official annual files, reject ambiguous or backup copies, and do not acquire missing data during validation.",
  "For every contractor produce an evidence-backed commercial disposition and next-action state.",
  "Companies with stale or missing contacts must remain visible for qualification or enrichment rather than disappearing.",
  "Calculate the exact aligned FY2026 unique prime awardee universe, unique subcontract awardee universe, overlap across roles, and deduped union across either awarded role.",
  "Persist every exact awarded UEI into the canonical P2GC contractor master with PRIME, SUB, or BOTH role and award evidence.",
  "Apply the P2GC Master Contractor Segmentation Taxonomy as a multi-dimensional non-mutually-exclusive overlay; retain many taxonomy tags while allowing only one primary outbound campaign assignment per company.",
  "Retain a proven existing GSA, VA, SAM, certification, SBS, expiring, or SLED primary outbound segment where available; otherwise assign a governed awarded-role/value fallback segment.",
  "Missing or stale contacts must enter verification or enrichment states, not cause the company to disappear.",
  "Only verified unsuppressed contacts may appear in outbound-ready segment exports.",
  "Do not send email, activate campaigns, mutate providers, override suppression, modify historical B12 sources, modify the current outbound master, or modify production ORION."
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

  let b12Discovery = null;
  let localAwardHistory = null;
  let sixFySourceValidation = null;
  let awards = null;
  let canonical = null;
  let taxonomy = null;
  if (result?.ok === true) {
    b12Discovery = new B12HistoricalUniverseDiscoveryService().discover();
    localAwardHistory = new AwardHistoryLocalInventoryService().run();
    if (localAwardHistory?.ok === true) {
      sixFySourceValidation = new SixFiscalYearAwardSourceValidationService().run({ inventory: localAwardHistory });
    }
    awards = await new Fy2026AwardedUniverseCoverageService().run();
    if (awards?.ok === true) {
      canonical = await new CanonicalAwardedContractorMasterService().run({ coverage: awards });
      if (canonical?.ok === true) taxonomy = new CanonicalContractorTaxonomyOverlayService().run({ canonical });
    }
  }

  const compactSourceYears = sixFySourceValidation?.byYear
    ? Object.fromEntries(Object.entries(sixFySourceValidation.byYear).map(([year, value]) => [year, {
        primeReady: value.prime?.ready === true,
        primeFiles: (value.prime?.selected || []).map(item => item.file),
        subcontractReady: value.subcontract?.ready === true,
        subcontractFiles: (value.subcontract?.selected || []).map(item => item.file)
      }]))
    : null;

  const compact = {
    ok: result?.ok === true && b12Discovery?.ok === true && localAwardHistory?.ok === true && sixFySourceValidation?.ok === true && awards?.ok === true && canonical?.ok === true && taxonomy?.ok === true,
    status: taxonomy?.status || canonical?.status || result?.status || null,
    service: result?.service || null,
    mode: result?.mode || null,
    completedAt: result?.completedAt || null,
    universe: result?.universe || null,
    immediateAnswers: result?.immediateAnswers || null,
    b12HistoricalDiscovery: b12Discovery ? {
      ok: b12Discovery.ok === true,
      status: b12Discovery.status || null,
      historicalWindow: b12Discovery.historicalWindow || null,
      scanRoots: b12Discovery.scope?.scanRoots || [],
      filesVisited: b12Discovery.scope?.filesVisited ?? null,
      directoriesVisited: b12Discovery.scope?.directoriesVisited ?? null,
      registryReferencedSources: b12Discovery.registry?.referencedSourceCount ?? null,
      inventory: b12Discovery.inventory || null,
      duplicateArtifactHashGroups: b12Discovery.duplicateArtifacts?.length || 0,
      errors: (b12Discovery.errors || []).slice(0, 25),
      nextGate: b12Discovery.nextGate || null,
      outputs: b12Discovery.outputs || null,
      safety: b12Discovery.safety || null
    } : null,
    localAwardHistory: localAwardHistory ? {
      ok: localAwardHistory.ok === true,
      status: localAwardHistory.status || null,
      rootsSearched: localAwardHistory.rootsSearched || null,
      filesVisited: localAwardHistory.filesVisited || null,
      candidateFiles: localAwardHistory.candidateFiles || null,
      fiscalYears: localAwardHistory.fiscalYears ? Object.fromEntries(Object.entries(localAwardHistory.fiscalYears).map(([year, value]) => [year, { candidateCount: value.candidateCount }])) : null,
      nextRule: localAwardHistory.nextRule || null,
      safety: localAwardHistory.safety || null
    } : null,
    sixFySourceValidation: sixFySourceValidation ? {
      ok: sixFySourceValidation.ok === true,
      status: sixFySourceValidation.status || null,
      inspectedCandidates: sixFySourceValidation.inspectedCandidates || 0,
      usableCsvSources: sixFySourceValidation.usableCsvSources || 0,
      readyForSixFiscalYearNormalization: sixFySourceValidation.readyForSixFiscalYearNormalization === true,
      fiscalYears: compactSourceYears,
      missingRequirements: sixFySourceValidation.missingRequirements || [],
      sourceRules: sixFySourceValidation.sourceRules || null,
      safety: sixFySourceValidation.safety || null,
      artifacts: sixFySourceValidation.artifacts || null
    } : null,
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
    taxonomy: taxonomy ? {
      ok: taxonomy.ok === true,
      status: taxonomy.status || null,
      counts: taxonomy.counts || null,
      acceptance: taxonomy.acceptance || null,
      artifacts: taxonomy.artifacts || null,
      safety: taxonomy.safety || null
    } : null,
    acceptance: result?.acceptance || null,
    outputs: result?.outputs || null,
    safety: result?.safety || null,
    error: result?.error || b12Discovery?.errors?.[0]?.error || sixFySourceValidation?.error || awards?.error || canonical?.error || taxonomy?.error || null
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
