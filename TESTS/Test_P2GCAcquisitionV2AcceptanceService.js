'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P2GCAcquisitionV2AcceptanceService = require('../SERVICES/revenue/P2GCAcquisitionV2AcceptanceService');

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}
function proof(root) {
  write(path.join(root, 'DATA/marketing_coo/p2gc_proof_registry.json'), {
    approved: [
      { status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' },
      { status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' },
      { status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' }
    ]
  });
}
function runtimeEvidence(root, generatedAt) {
  const stamp = { generatedAt };
  write(path.join(root, 'DATA/revenue_pipeline/latest_revenue_weighted_campaign_scorecard.json'), { ...stamp, ok: true, totals: { campaigns: 3 } });
  write(path.join(root, 'DATA/runtime/revenue/nurture/run_once_latest.json'), { ...stamp, ok: true, executeRequested: true, result: { report: { dueQueued: 0 }, execution: { ok: true, attempted: 0, executed: 0 } } });
  write(path.join(root, 'DATA/runtime/revenue/pathway_score/live_latest.json'), { ...stamp, ok: true, term: 'Example', result: { score: { score: 80 } } });
  write(path.join(root, 'DATA/runtime/revenue/p2gc_acquisition_v2/pilot_deployment_latest.json'), { ...stamp, ok: true, executeRequested: true, activationRequested: true, enrichment: { accepted: 0 }, deployments: [], executionTruth: 'NO_EXTERNAL_MUTATION' });
  write(path.join(root, 'DATA/website_ops/b12_conversion_v2/latest.json'), { ...stamp, ok: true, publicPublishExecuted: true, status: 'PUBLIC_PUBLISH_SUBMITTED' });
  write(path.join(root, 'DATA/website_ops/p2gc_conversion_audit/latest.json'), { ...stamp, ok: true });
  write(path.join(root, 'DATA/marketing_coo/authority_content/production_queue_latest.json'), { ...stamp, ok: true, totals: { ready: 5 } });
  write(path.join(root, 'DATA/marketing_coo/buyer_lens_content/buyer_lens_queue_latest.json'), { ...stamp, ok: true, totals: { ready: 2 } });
  write(path.join(root, 'DATA/marketing_coo/competitor_intelligence/experiment_queue_latest.json'), { ...stamp, ok: true, totals: { experimentsCreated: 3 } });
  write(path.join(root, 'DATA/marketing_coo/linkedin_publish/latest.json'), { ...stamp, ok: true, mutationExecuted: true, status: 'POST_PUBLISHED' });
}

(() => {
  const now = new Date('2026-08-28T20:00:00Z');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-accept-fresh-'));
  proof(root);
  runtimeEvidence(root, '2026-08-28T19:30:00Z');
  const service = new P2GCAcquisitionV2AcceptanceService({ rootDir: root, now: () => now });
  const result = service.run();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'END_TO_END_ACCEPTED');
  assert.equal(result.totals.incomplete, 0);
  assert.ok(fs.existsSync(result.outputFile));
  assert.equal(result.acceptanceFreshnessMs, 24 * 60 * 60 * 1000);
})();

(() => {
  const now = new Date('2026-08-28T20:00:00Z');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-accept-stale-'));
  proof(root);
  runtimeEvidence(root, '2026-08-25T19:30:00Z');
  const service = new P2GCAcquisitionV2AcceptanceService({ rootDir: root, now: () => now });
  const result = service.run();
  assert.equal(result.ok, false);
  assert(result.blockers.some(x => x.status === 'PENDING_STALE_EVIDENCE'));
  assert.equal(result.checks.find(x => x.id === 'SCORECARD').complete, false);
})();

(() => {
  const now = new Date('2026-08-28T20:00:00Z');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-accept-undated-'));
  proof(root);
  runtimeEvidence(root, '2026-08-28T19:30:00Z');
  write(path.join(root, 'DATA/revenue_pipeline/latest_revenue_weighted_campaign_scorecard.json'), { ok: true, totals: { campaigns: 3 } });
  const service = new P2GCAcquisitionV2AcceptanceService({ rootDir: root, now: () => now });
  const result = service.run();
  const score = result.checks.find(x => x.id === 'SCORECARD');
  assert.equal(score.status, 'PENDING_UNDATED_EVIDENCE');
  assert.equal(score.complete, false);
})();

console.log('P2GCAcquisitionV2AcceptanceService freshness tests passed');
