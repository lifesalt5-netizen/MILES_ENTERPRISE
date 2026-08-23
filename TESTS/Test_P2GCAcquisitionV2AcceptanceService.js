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

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-accept-'));
  write(path.join(root, 'DATA/marketing_coo/p2gc_proof_registry.json'), {
    approved: [
      { status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' },
      { status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' },
      { status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' }
    ]
  });
  write(path.join(root, 'DATA/revenue_pipeline/latest_revenue_weighted_campaign_scorecard.json'), { ok: true, totals: { campaigns: 3 } });
  write(path.join(root, 'DATA/runtime/revenue/nurture/run_once_latest.json'), { ok: true, executeRequested: true, result: { report: { dueQueued: 0 }, execution: { ok: true, attempted: 0, executed: 0 } } });
  write(path.join(root, 'DATA/runtime/revenue/pathway_score/live_latest.json'), { ok: true, term: 'Example', result: { score: { score: 80 } } });
  write(path.join(root, 'DATA/runtime/revenue/p2gc_acquisition_v2/pilot_deployment_latest.json'), { ok: true, executeRequested: true, activationRequested: true, enrichment: { accepted: 0 }, deployments: [], executionTruth: 'NO_EXTERNAL_MUTATION' });
  write(path.join(root, 'DATA/website_ops/b12_conversion_v2/latest.json'), { ok: true, publicPublishExecuted: true, status: 'PUBLIC_PUBLISH_SUBMITTED' });
  write(path.join(root, 'DATA/website_ops/p2gc_conversion_audit/latest.json'), { ok: true });
  write(path.join(root, 'DATA/marketing_coo/authority_content/production_queue_latest.json'), { ok: true, totals: { ready: 5 } });
  write(path.join(root, 'DATA/marketing_coo/buyer_lens_content/buyer_lens_queue_latest.json'), { ok: true, totals: { ready: 2 } });
  write(path.join(root, 'DATA/marketing_coo/competitor_intelligence/experiment_queue_latest.json'), { ok: true, totals: { experimentsCreated: 3 } });
  write(path.join(root, 'DATA/marketing_coo/linkedin_publish/latest.json'), { ok: true, mutationExecuted: true, status: 'POST_PUBLISHED' });

  const service = new P2GCAcquisitionV2AcceptanceService({ rootDir: root });
  const result = service.run();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'END_TO_END_ACCEPTED');
  assert.equal(result.totals.incomplete, 0);
  assert.ok(fs.existsSync(result.outputFile));
  console.log('P2GCAcquisitionV2AcceptanceService tests passed');
})();
