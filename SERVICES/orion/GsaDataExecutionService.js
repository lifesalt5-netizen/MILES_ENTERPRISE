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
    const holderReconciliationModule = loadOptional(this.rootDir, path.join('SERVICES', 'orion', 'GsaHolderReconciliationService.js'));
    const stagingAcceptanceModule = loadOptional(this.rootDir, path.join('SERVICES', 'orion', 'GsaExecutionAcceptanceService.js'));
    const awardAggregationModule = loadOptional(this.rootDir, path.join('SERVICES', 'orion', 'UsaspendingAwardAggregationService.js'));
    const segmentationModule = loadOptional(this.rootDir, path.join('SERVICES', 'orion', 'GsaSalesSegmentationService.js'));
    const sampleTruthModule = loadOptional(this.rootDir, path.join('SERVICES', 'orion', 'GsaSampleTruthVerificationService.js'));
    const finalAcceptanceModule = loadOptional(this.rootDir, path.join('SERVICES', 'orion', 'GsaFinalMissionAcceptanceService.js'));

    const capabilityEvidence = {
      gsaElibraryReadiness: readiness.ok === true,
      holderSnapshotService: holderModule.available,
      usaspendingStagingService: spendingModule.available,
      gsaMatcherService: matcherModule.available,
      governmentDataNormalizerService: normalizerModule.available,
      segmentReconciliationService: reconciliationModule.available,
      holderReconciliationService: holderReconciliationModule.available,
      stagingAcceptanceService: stagingAcceptanceModule.available,
      awardAggregationService: awardAggregationModule.available,
      salesSegmentationService: segmentationModule.available,
      sampleTruthVerificationService: sampleTruthModule.available,
      finalAcceptanceService: finalAcceptanceModule.available
    };

    const blockers = [];
    const preconditionBlockers = [];
    if (!readiness.ok) preconditionBlockers.push(...(readiness.blockers || ['GSA_ELIBRARY_NOT_READY']));
    for (const [name, ok] of Object.entries(capabilityEvidence)) {
      if (name !== 'gsaElibraryReadiness' && !ok) preconditionBlockers.push(`MISSING_CAPABILITY_${name.toUpperCase()}`);
    }
    blockers.push(...preconditionBlockers);

    const results = {};

    if (preconditionBlockers.length === 0) {
      try {
        const HolderService = holderModule.module;
        const holderService = new HolderService({ root: this.rootDir });
        results.gsaHolderRefresh = await holderService.refresh({
          apiKey: process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY || undefined
        });
      } catch (error) {
        blockers.push(`GSA_HOLDER_REFRESH_FAILED:${error.message}`);
      }

      if (results.gsaHolderRefresh?.ok) {
        try {
          const HolderReconciliationService = holderReconciliationModule.module;
          const holderReconciliation = new HolderReconciliationService({ rootDir: this.rootDir });
          results.gsaReconciliation = await holderReconciliation.run({
            currentManifestPath: results.gsaHolderRefresh.manifestPath
          });
          if (!results.gsaReconciliation?.ok) {
            blockers.push(`GSA_HOLDER_RECONCILIATION_BLOCKED:${results.gsaReconciliation?.blocker || results.gsaReconciliation?.status || 'UNKNOWN'}`);
          }
        } catch (error) {
          blockers.push(`GSA_HOLDER_RECONCILIATION_FAILED:${error.message}`);
        }
      }

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

      try {
        const AcceptanceService = stagingAcceptanceModule.module;
        const acceptance = new AcceptanceService({ rootDir: this.rootDir });
        results.acceptance = acceptance.run({
          gsaHolderRefresh: results.gsaHolderRefresh,
          usaspendingRefresh: results.usaspendingRefresh,
          gsaReconciliation: results.gsaReconciliation,
          limitations: Array.isArray(results.gsaHolderRefresh?.warnings) ? results.gsaHolderRefresh.warnings : []
        });
      } catch (error) {
        blockers.push(`GSA_STAGING_ACCEPTANCE_REPORT_FAILED:${error.message}`);
      }

      if (results.usaspendingRefresh?.ok) {
        try {
          const AwardAggregationService = awardAggregationModule.module;
          const aggregation = new AwardAggregationService({ rootDir: this.rootDir });
          results.awardAggregation = await aggregation.run({
            usaspendingManifestPath: results.usaspendingRefresh.manifestPath
          });
          if (!results.awardAggregation?.ok) {
            blockers.push(`USASPENDING_AWARD_AGGREGATION_BLOCKED:${results.awardAggregation?.blocker || results.awardAggregation?.status || 'UNKNOWN'}`);
          }
        } catch (error) {
          blockers.push(`USASPENDING_AWARD_AGGREGATION_FAILED:${error.message}`);
        }
      }

      if (results.gsaHolderRefresh?.ok && results.awardAggregation?.ok) {
        try {
          const SegmentationService = segmentationModule.module;
          const segmentation = new SegmentationService({ rootDir: this.rootDir });
          results.segmentation = await segmentation.run({
            holderManifestPath: results.gsaHolderRefresh.manifestPath,
            awardAggregatePath: results.awardAggregation.aggregatePath,
            reconciliationReportPath: results.gsaReconciliation?.reportPath || null,
            measurementWindow: {
              startDate: process.env.MILES_USASPENDING_START_DATE || '2026-02-01',
              endDate: new Date().toISOString().slice(0, 10)
            }
          });
          if (!results.segmentation?.ok) {
            blockers.push(`GSA_SEGMENTATION_BLOCKED:${results.segmentation?.blocker || results.segmentation?.status || 'UNKNOWN'}`);
          }
        } catch (error) {
          blockers.push(`GSA_SEGMENTATION_FAILED:${error.message}`);
        }
      }

      if (results.segmentation?.ok) {
        try {
          const SampleTruthService = sampleTruthModule.module;
          const verifier = new SampleTruthService({ rootDir: this.rootDir });
          results.sampleTruth = await verifier.run({ segmentedPath: results.segmentation.segmentedPath, sampleSize: 25 });
          if (!results.sampleTruth?.ok) blockers.push('GSA_SAMPLE_TRUTH_VERIFICATION_FAILED');
        } catch (error) {
          blockers.push(`GSA_SAMPLE_TRUTH_VERIFICATION_FAILED:${error.message}`);
        }
      }

      try {
        const FinalAcceptanceService = finalAcceptanceModule.module;
        const finalAcceptance = new FinalAcceptanceService({ rootDir: this.rootDir });
        results.finalAcceptance = finalAcceptance.run({
          stagingAcceptance: results.acceptance,
          awardAggregation: results.awardAggregation,
          segmentation: results.segmentation,
          sampleTruth: results.sampleTruth
        });
        if (!results.finalAcceptance?.ok) {
          for (const blocker of results.finalAcceptance?.blockers || []) {
            if (!blockers.includes(blocker)) blockers.push(blocker);
          }
        }
      } catch (error) {
        blockers.push(`GSA_FINAL_ACCEPTANCE_REPORT_FAILED:${error.message}`);
      }
    }

    const fullMissionComplete = results.finalAcceptance?.fullMissionComplete === true && blockers.length === 0;
    const status = fullMissionComplete ? 'COMPLETED' : (blockers.length ? 'BLOCKED' : 'IN_PROGRESS');
    const record = {
      ok: fullMissionComplete,
      status,
      service: 'GsaDataExecutionService',
      objective,
      startedAt,
      completedAt: isoNow(),
      mode: 'STAGING_ONLY_NO_INSTANTLY_PUSH',
      capabilityEvidence,
      readiness,
      results,
      limitations: Array.isArray(results.gsaHolderRefresh?.warnings) ? results.gsaHolderRefresh.warnings : [],
      blockers,
      completionEvidence: {
        authoritativeGsaRefreshProduced: Boolean(results.gsaHolderRefresh?.ok),
        samEnrichmentAvailable: results.gsaHolderRefresh?.rules?.samEnrichmentAvailable !== false,
        usaspendingRefreshProduced: Boolean(results.usaspendingRefresh?.ok),
        reconciliationProduced: Boolean(results.gsaReconciliation?.ok),
        stagingAcceptanceReportProduced: Boolean(results.acceptance?.reportPath),
        awardAggregationProduced: Boolean(results.awardAggregation?.ok),
        segmentationProduced: Boolean(results.segmentation?.ok),
        campaignReadyStagingProduced: Boolean(results.segmentation?.campaignReadyPath && fs.existsSync(results.segmentation.campaignReadyPath)),
        sampleTruthVerificationPassed: Boolean(results.sampleTruth?.ok),
        finalAcceptanceReportProduced: Boolean(results.finalAcceptance?.reportPath),
        fullMissionComplete
      },
      outputPaths: {
        holderManifest: results.gsaHolderRefresh?.manifestPath || null,
        usaspendingManifest: results.usaspendingRefresh?.manifestPath || null,
        reconciliationReport: results.gsaReconciliation?.reportPath || null,
        stagingAcceptanceReport: results.acceptance?.reportPath || null,
        awardAggregationReport: results.awardAggregation?.reportPath || null,
        awardAggregatePath: results.awardAggregation?.aggregatePath || null,
        segmentationReport: results.segmentation?.reportPath || null,
        segmentedHolders: results.segmentation?.segmentedPath || null,
        campaignReadyStaging: results.segmentation?.campaignReadyPath || null,
        sampleTruthReport: results.sampleTruth?.reportPath || null,
        finalAcceptanceReport: results.finalAcceptance?.reportPath || null
      }
    };

    fs.writeFileSync(path.join(this.outDir, 'latest_gsa_data_execution.json'), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  async execute(task = {}) { return this.run(task); }
}

module.exports = new GsaDataExecutionService();
module.exports.GsaDataExecutionService = GsaDataExecutionService;
module.exports.loadOptional = loadOptional;
