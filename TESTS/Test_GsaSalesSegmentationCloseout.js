'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const SegmentationService = require('../SERVICES/orion/GsaSalesSegmentationService');
const SampleTruthService = require('../SERVICES/orion/GsaSampleTruthVerificationService');
const FinalAcceptanceService = require('../SERVICES/orion/GsaFinalMissionAcceptanceService');

function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  assert(SegmentationService.salesBand(0) === 'GSA_NO_SALES', '0 sales band');
  assert(SegmentationService.salesBand(99999) === 'GSA_0_100K', '<100k band');
  assert(SegmentationService.salesBand(100000) === 'GSA_100K_500K', '100k band');
  assert(SegmentationService.salesBand(5000000) === 'GSA_5M_PLUS', '5m band');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-gsa-closeout-'));
  const snap = path.join(root, 'DATA', 'staging', 'government_data', 'gsa_holder_snapshot', 'run');
  fs.mkdirSync(snap, { recursive: true });
  const holderPath = path.join(snap, 'gsa_current_mas_holders.jsonl');
  fs.writeFileSync(holderPath, JSON.stringify({
    uei: 'UEI123', contractNumber: '47QTCA26D0001', legalBusinessName: 'TEST CO',
    ultimateContractEndDate: '2026-11-01', categories: ['SIN1', 'SIN2'],
    sourceEmail: 'person@example.com', verifiedEmail: true
  }) + '\n');
  const holderManifest = path.join(snap, 'manifest.json');
  fs.writeFileSync(holderManifest, JSON.stringify({ artifacts: [{ filePath: holderPath }] }));

  const aggRoot = path.join(root, 'DATA', 'staging', 'government_data', 'usaspending_aggregation', 'run');
  fs.mkdirSync(aggRoot, { recursive: true });
  const aggPath = path.join(aggRoot, 'award_aggregates_by_uei.jsonl');
  fs.writeFileSync(aggPath, JSON.stringify({
    uei: 'UEI123', primeFederalObligations: 900000, subawardObligations: 0,
    contractRefs: { '47QTCA26D0001': 50000 }, topAwardingAgency: 'AGENCY', topAgencyShare: 0.8
  }) + '\n');

  const segmentation = await new SegmentationService({ rootDir: root }).run({
    holderManifestPath: holderManifest,
    awardAggregatePath: aggPath,
    measurementWindow: { startDate: '2026-02-01', endDate: '2026-08-31' },
    now: '2026-08-31T12:00:00Z'
  });
  assert(segmentation.ok === true, 'segmentation should complete');
  assert(segmentation.counts.holders === 1, 'one holder expected');
  assert(segmentation.counts.campaignReady === 1, 'verified holder should be campaign-ready staging');
  assert(segmentation.counts.segments.GSA_0_100K === 1, 'sales band should be counted');
  assert(segmentation.counts.segments.GSA_FEDERAL_SUCCESS_OUTSIDE_GSA === 1, 'outside-GSA signal expected');
  assert(segmentation.counts.segments.GSA_EXPANSION_CANDIDATE === 1, 'expansion candidate expected');

  const truth = await new SampleTruthService({ rootDir: root }).run({ segmentedPath: segmentation.segmentedPath, sampleSize: 25 });
  assert(truth.ok === true && truth.checksFailed === 0, 'sample truth should pass');

  const fakeStagingReport = path.join(root, 'stage.json'); fs.writeFileSync(fakeStagingReport, '{}');
  const fakeAggReport = path.join(root, 'agg.json'); fs.writeFileSync(fakeAggReport, '{}');
  const final = new FinalAcceptanceService({ rootDir: root }).run({
    stagingAcceptance: { status: 'STAGING_ACCEPTED', reportPath: fakeStagingReport },
    awardAggregation: { ok: true, reportPath: fakeAggReport, aggregatePath: aggPath, counts: { rows: 1, uniqueUeis: 1 } },
    segmentation,
    sampleTruth: truth
  });
  assert(final.ok === true && final.fullMissionComplete === true, 'final acceptance should close mission');
  console.log('GSA_SALES_SEGMENTATION_CLOSEOUT_TEST_PASS');
})().catch(error => { console.error(error.stack || error); process.exit(1); });
