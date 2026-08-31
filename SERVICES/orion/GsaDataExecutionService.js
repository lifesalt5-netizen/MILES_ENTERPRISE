'use strict';

const fs = require('fs');
const path = require('path');
const GsaElibraryReadinessAuditService = require('./GsaElibraryReadinessAuditService');

function isoNow() { return new Date().toISOString(); }

function loadOptional(rootDir, relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) return { available: false, fullPath, module: null };
  try {
    delete require.cache[require.resolve(fullPath)];
    return { available: true, fullPath, module: require(fullPath) };
  } catch (error) {
    return { available: false, fullPath, module: null, error: error.message };
  }
}

class GsaDataExecutionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.outDir = path.join(this.rootDir, 'DATA', 'orion_refresh', 'gsa_execution');
  }

  async run(task = {}) {
    fs.mkdirSync(this.outDir, { recursive: true });
    const startedAt = isoNow();
    const objective = String(task.objective || task.payload?.objective || task.payload?.command || task.command || '');
    const readiness = await new GsaElibraryReadinessAuditService({ rootDir: this.rootDir }).run();

    const holderModule = loadOptional(this.rootDir, path.join('SERVICES', 'GsaHolderSnapshotResilientService.js'));
    const spendingModule = loadOptional(this.rootDir, path.join('SERVICES', 'UsaspendingAwardHistoryStagingService.js'));
    const matcherModule = loadOptional(this.rootDir, path.join('SERVICES', 'GovernmentDataGsaMatcherService.js'));
    const normalizerModule = loadOptional(this.rootDir, path.join('SERVICES', 'GovernmentDataNormalizerService.js'));
    const reconciliationModule = loadOptional(this.rootDir, path.join('SERVICES', 'LegacySegmentReconciliationService.js'));

    const capabilityEvidence = {
      gsaElibraryReadiness: readiness.ok === true,
      holderSnapshotService: holderModule.available,
      usaspendingStagingService: spendingModule.available,
      gsaMatcherService: matcherModule.available,
      governmentDataNormalizerService: normalizerModule.available,
      segmentReconciliationService: reconciliationModule.available
    };

    const blockers = [];
    if (!readiness.ok) blockers.push(...(readiness.blockers || ['GSA_ELIBRARY_NOT_READY']));
    for (const [name, ok] of Object.entries(capabilityEvidence)) {
      if (name !== 'gsaElibraryReadiness' && !ok) blockers.push(`MISSING_CAPABILITY_${name.toUpperCase()}`);
    }

    const results = {};

    if (blockers.length === 0) {
      try {
        const HolderService = holderModule.module;
        const holderService = new HolderService({ root: this.rootDir });
        results.gsaHolderRefresh = await holderService.refresh({
          apiKey: process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY || undefined
        });
      } catch (error) {
        blockers.push(`GSA_HOLDER_REFRESH_FAILED:${error.message}`);
      }

      if (blockers.length === 0) {
        try {
          const SpendingService = spendingModule.module;
          const spendingService = new SpendingService({ root: this.rootDir });
          results.usaspendingRefresh = await spendingService.refresh({
            startDate: process.env.MILES_USASPENDING_START_DATE || '2026-02-01',
            endDate: new Date().toISOString().slice(0, 10)
          });
        } catch (error) {
          blockers.push(`USASPENDING_REFRESH_FAILED:${error.message}`);
        }
      }
    }

    const acceptanceReady = blockers.length === 0 &&
      Boolean(results.gsaHolderRefresh?.ok) &&
      Boolean(results.usaspendingRefresh?.ok) &&
      capabilityEvidence.gsaMatcherService &&
      capabilityEvidence.governmentDataNormalizerService &&
      capabilityEvidence.segmentReconciliationService;

    if (acceptanceReady) {
      blockers.push('GSA_RECONCILIATION_AND_ACCEPTANCE_PIPELINE_NOT_YET_WIRED_TO_CURRENT_RUNTIME');
    }

    const status = blockers.length ? 'BLOCKED' : 'IN_PROGRESS';
    const record = {
      ok: false,
      status,
      service: 'GsaDataExecutionService',
      objective,
      startedAt,
      completedAt: isoNow(),
      mode: 'STAGING_ONLY_NO_INSTANTLY_PUSH',
      capabilityEvidence,
      readiness,
      results,
      limitations: Array.isArray(results.gsaHolderRefresh?.warnings)
        ? results.gsaHolderRefresh.warnings
        : [],
      blockers,
      completionEvidence: {
        authoritativeGsaRefreshProduced: Boolean(results.gsaHolderRefresh?.ok),
        samEnrichmentAvailable: results.gsaHolderRefresh?.rules?.samEnrichmentAvailable !== false,
        usaspendingRefreshProduced: Boolean(results.usaspendingRefresh?.ok),
        reconciliationProduced: false,
        segmentationProduced: false,
        campaignReadyStagingProduced: false,
        acceptanceReportProduced: false,
        fullMissionComplete: false
      }
    };

    fs.writeFileSync(
      path.join(this.outDir, 'latest_gsa_data_execution.json'),
      JSON.stringify(record, null, 2),
      'utf8'
    );
    return record;
  }

  async execute(task = {}) {
    return this.run(task);
  }
}

module.exports = new GsaDataExecutionService();
module.exports.GsaDataExecutionService = GsaDataExecutionService;
module.exports.loadOptional = loadOptional;
