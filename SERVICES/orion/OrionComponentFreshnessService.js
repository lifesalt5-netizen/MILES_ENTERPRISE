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

class OrionComponentFreshnessService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.nowMs = Number(options.nowMs || Date.now());
    this.sidecarReport = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.sourceAvailability = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_availability.json');
  }

  run(coreFreshness = null) {
    const sidecar = readJson(this.sidecarReport);
    const availability = readJson(this.sourceAvailability);
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

    const sourceDate = sidecarUsable ? (sidecar?.source?.updatedDate || selectedFull?.updated_date || null) : null;
    const sourceAgeHours = ageHours(sourceDate, this.nowMs);
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
      samRegistration: { status: 'SEPARATE_CURRENT_SOURCE_REQUIRED', fresh: false, scope: 'SAM entity/registration truth' },
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
      freshComponents: freshNames,
      unresolvedComponents: staleNames,
      components,
      rules: {
        databaseMtimeAloneCannotProveFullFreshness: true,
        contractSidecarCannotProveSamOrOpportunityFreshness: true,
        recommendationAndPersonaFreshnessRequiresUpstreamRefreshAndRegeneration: true,
        noFabricatedFreshness: true
      }
    };
  }
}

module.exports = OrionComponentFreshnessService;
module.exports.ageHours = ageHours;
