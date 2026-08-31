'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return null; }
}
function parseDate(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}
function ageHours(value, nowMs = Date.now()) {
  const ms = parseDate(value);
  return ms == null ? null : Math.round(((nowMs - ms) / 3600000) * 100) / 100;
}
function withinHours(value, maxHours, nowMs = Date.now()) {
  const age = ageHours(value, nowMs);
  return age != null && age >= 0 && age <= maxHours;
}

class OrionComponentFreshnessService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.nowMs = Number(options.nowMs || Date.now());
    this.sidecarReport = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.sourceAvailability = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_availability.json');
    this.samQualifiedReport = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_sam_qualified_universe_build.json');
    this.gsaFinalAcceptanceReport = path.join(this.rootDir, 'DATA', 'orion_refresh', 'gsa_execution', 'latest_gsa_final_acceptance_report.json');
    this.samMaxAgeHours = Math.max(24, Number(options.samMaxAgeHours || process.env.MILES_SAM_FRESHNESS_MAX_HOURS || 35 * 24));
    this.gsaMaxAgeHours = Math.max(24, Number(options.gsaMaxAgeHours || process.env.MILES_GSA_FRESHNESS_MAX_HOURS || 7 * 24));
  }

  run(coreFreshness = null) {
    const sidecar = readJson(this.sidecarReport);
    const availability = readJson(this.sourceAvailability);
    const sam = readJson(this.samQualifiedReport);
    const gsa = readJson(this.gsaFinalAcceptanceReport);
    const selectedFull = availability?.selected?.full || null;

    const sidecarUsable = Boolean(
      sidecar?.ok === true &&
      sidecar?.safety?.productionDatabaseModified === false &&
      sidecar?.safety?.sidecarOnly === true &&
      sidecar?.sidecarDb && fs.existsSync(sidecar.sidecarDb) &&
      sidecar?.validation?.ok === true &&
      sidecar?.source?.archive &&
      selectedFull?.file_name &&
      sidecar.source.archive === selectedFull.file_name
    );

    const samEvidenceUsable = Boolean(
      sam?.ok === true &&
      sam?.safety?.productionDatabaseModified === false &&
      sam?.safety?.stagingOnly === true &&
      sam?.output?.database &&
      fs.existsSync(sam.output.database) &&
      Number(sam?.output?.storedQualifiedCompanies || 0) > 0 &&
      withinHours(sam.generatedAt, this.samMaxAgeHours, this.nowMs)
    );

    const gsaEvidenceUsable = Boolean(
      gsa?.ok === true &&
      gsa?.status === 'MISSION_ACCEPTED' &&
      gsa?.fullMissionComplete === true &&
      gsa?.safety?.productionOrionModified === false &&
      gsa?.outputPaths?.segmentedHolders &&
      fs.existsSync(gsa.outputPaths.segmentedHolders) &&
      gsa?.outputPaths?.sampleTruthReport &&
      fs.existsSync(gsa.outputPaths.sampleTruthReport) &&
      withinHours(gsa.generatedAt, this.gsaMaxAgeHours, this.nowMs)
    );

    const sourceDate = sidecarUsable ? (sidecar?.source?.updatedDate || selectedFull?.updated_date || null) : null;
    const sourceAgeHours = ageHours(sourceDate, this.nowMs);
    const samAgeHours = ageHours(sam?.generatedAt, this.nowMs);
    const gsaAgeHours = ageHours(gsa?.generatedAt, this.nowMs);

    const components = {
      contracts: {
        status: sidecarUsable ? 'CURRENT_OFFICIAL_SOURCE' : 'STALE_OR_UNVERIFIED',
        fresh: sidecarUsable,
        source: sidecarUsable ? 'USAspending FY contract full archive' : null,
        sourceUpdatedDate: sourceDate,
        sourceAgeHours,
        sidecarDb: sidecarUsable ? sidecar.sidecarDb : null,
        scope: 'FY2026 contract awards only'
      },
      awardDerivedBuyers: {
        status: sidecarUsable ? 'CURRENT_OFFICIAL_SOURCE_DERIVED' : 'STALE_OR_UNVERIFIED',
        fresh: sidecarUsable,
        sourceUpdatedDate: sourceDate,
        scope: 'FY2026 award-derived buyer facts'
      },
      awardDerivedRecompetes: {
        status: sidecarUsable ? 'CURRENT_OFFICIAL_SOURCE_DERIVED' : 'STALE_OR_UNVERIFIED',
        fresh: sidecarUsable,
        sourceUpdatedDate: sourceDate,
        scope: 'FY2026 award performance-end-derived recompete facts'
      },
      samRegistration: {
        status: samEvidenceUsable ? 'CURRENT_GOVERNED_SAM_QUALIFIED_UNIVERSE' : 'STALE_OR_UNVERIFIED',
        fresh: samEvidenceUsable,
        sourceUpdatedDate: sam?.generatedAt || null,
        sourceAgeHours: samAgeHours,
        sourceDate: sam?.source?.date || null,
        qualifiedCompanies: samEvidenceUsable ? Number(sam?.output?.storedQualifiedCompanies || 0) : null,
        evidenceReport: this.samQualifiedReport,
        scope: 'Qualified active commercial SAM registration universe; contact verification remains separately governed'
      },
      gsaVehicleIntelligence: {
        status: gsaEvidenceUsable ? 'CURRENT_GSA_MISSION_ACCEPTED' : 'STALE_OR_UNVERIFIED',
        fresh: gsaEvidenceUsable,
        sourceUpdatedDate: gsa?.generatedAt || null,
        sourceAgeHours: gsaAgeHours,
        currentHoldersSegmented: gsaEvidenceUsable ? (gsa?.counts?.currentHoldersSegmented ?? null) : null,
        campaignReady: gsaEvidenceUsable ? (gsa?.counts?.campaignReady ?? null) : null,
        evidenceReport: this.gsaFinalAcceptanceReport,
        scope: 'GSA MAS holder, USAspending aggregation, reconciliation, segmentation and sample-truth evidence'
      },
      opportunities: { status: 'SEPARATE_CURRENT_SOURCE_REQUIRED', fresh: false, scope: 'Current solicitations/opportunities' },
      recommendations: { status: 'REGENERATION_AFTER_UPSTREAM_REFRESH_REQUIRED', fresh: false, scope: 'Derived recommendations' },
      personas: { status: 'REGENERATION_AFTER_UPSTREAM_REFRESH_REQUIRED', fresh: false, scope: 'Derived persona scores' }
    };

    const freshNames = Object.entries(components).filter(([,v]) => v.fresh === true).map(([k]) => k);
    const staleNames = Object.entries(components).filter(([,v]) => v.fresh !== true).map(([k]) => k);
    const overallStatus = freshNames.length && staleNames.length ? 'PARTIAL_FRESHNESS' : freshNames.length === Object.keys(components).length ? 'FULLY_FRESH' : 'STALE';

    return {
      ok: true,
      service: 'ORION_COMPONENT_FRESHNESS',
      generatedAt: new Date(this.nowMs).toISOString(),
      overallStatus,
      fullyFresh: overallStatus === 'FULLY_FRESH',
      partialFreshness: overallStatus === 'PARTIAL_FRESHNESS',
      coreDatabaseFreshness: coreFreshness || null,
      sidecarUsable,
      samEvidenceUsable,
      gsaEvidenceUsable,
      freshComponents: freshNames,
      unresolvedComponents: staleNames,
      components,
      rules: {
        databaseMtimeAloneCannotProveFullFreshness: true,
        contractSidecarCannotProveSamOrOpportunityFreshness: true,
        samQualificationCannotProveEmailDeliverability: true,
        gsaStagingAcceptanceCannotProveProductionOrionMutation: true,
        recommendationAndPersonaFreshnessRequiresUpstreamRefreshAndRegeneration: true,
        noFabricatedFreshness: true
      }
    };
  }
}

module.exports = OrionComponentFreshnessService;
module.exports.ageHours = ageHours;
module.exports.withinHours = withinHours;
