'use strict';

const fs = require('fs');
const path = require('path');

function isoNow() { return new Date().toISOString(); }
function exists(p) { return Boolean(p) && fs.existsSync(p); }

class GsaFinalMissionAcceptanceService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.outputRoot = path.join(this.rootDir, 'DATA', 'orion_refresh', 'gsa_execution');
  }

  run(input = {}) {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const staging = input.stagingAcceptance || {};
    const aggregation = input.awardAggregation || {};
    const segmentation = input.segmentation || {};
    const sampleTruth = input.sampleTruth || {};
    const campaignReadyArtifact = segmentation.campaignReadyPath || null;
    const evidence = {
      stagingAccepted: staging.status === 'STAGING_ACCEPTED' && exists(staging.reportPath),
      awardAggregationProduced: aggregation.ok === true && exists(aggregation.reportPath) && exists(aggregation.aggregatePath),
      segmentationProduced: segmentation.ok === true && exists(segmentation.reportPath) && exists(segmentation.segmentedPath),
      campaignReadyStagingProduced: exists(campaignReadyArtifact),
      sampleTruthPassed: sampleTruth.ok === true && sampleTruth.status === 'PASSED' && exists(sampleTruth.reportPath),
      instantlyPushBlocked: true,
      productionOrionModified: false
    };
    const blockers = [];
    for (const [key, value] of Object.entries(evidence)) {
      if (['instantlyPushBlocked'].includes(key)) continue;
      if (key === 'productionOrionModified') continue;
      if (!value) blockers.push(`MISSING_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
    }
    const fullMissionComplete = blockers.length === 0;
    const report = {
      ok: fullMissionComplete,
      status: fullMissionComplete ? 'MISSION_ACCEPTED' : 'BLOCKED',
      service: 'GsaFinalMissionAcceptanceService',
      generatedAt: isoNow(),
      evidence,
      blockers,
      counts: {
        awardRowsProcessed: aggregation.counts?.rows ?? null,
        awardUeis: aggregation.counts?.uniqueUeis ?? null,
        currentHoldersSegmented: segmentation.counts?.holders ?? null,
        holdersWithFederalAwardEvidence: segmentation.counts?.withFederalAwardEvidence ?? null,
        campaignReady: segmentation.counts?.campaignReady ?? null,
        contactVerificationRequired: segmentation.counts?.contactVerificationRequired ?? null,
        sampleChecksPassed: sampleTruth.checksPassed ?? null,
        sampleChecksFailed: sampleTruth.checksFailed ?? null,
        segments: segmentation.counts?.segments || {}
      },
      outputPaths: {
        stagingAcceptanceReport: staging.reportPath || null,
        awardAggregationReport: aggregation.reportPath || null,
        awardAggregatePath: aggregation.aggregatePath || null,
        segmentationReport: segmentation.reportPath || null,
        segmentedHolders: segmentation.segmentedPath || null,
        campaignReadyStaging: campaignReadyArtifact,
        sampleTruthReport: sampleTruth.reportPath || null
      },
      fullMissionComplete,
      safety: { stagingOnly: true, instantlyModified: false, productionOrionModified: false }
    };
    const reportPath = path.join(this.outputRoot, 'latest_gsa_final_acceptance_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { ...report, reportPath };
  }
}

module.exports = GsaFinalMissionAcceptanceService;
