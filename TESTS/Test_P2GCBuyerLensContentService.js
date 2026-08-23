'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P2GCBuyerLensContentService = require('../SERVICES/revenue/P2GCBuyerLensContentService');

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-buyer-lens-'));
  const snapshot = {
    snapshot_date: '2026-08-23',
    items: [{
      id: 'BL1', headline: 'Test update', official_status: 'PROPOSED_RULE_OR_PROPOSAL', source_name: 'Official Agency',
      source_url: 'https://example.gov/test', source_date: '2026-08-20', official_fact: 'Agency proposed a change.',
      affected_segments: ['SAM_GROWTH'], buyer_lens: 'Buyers may have a broader pool if finalized.',
      scrutiny: ['current eligibility', 'applicable NAICS'], benefit_or_risk: 'Some firms may gain eligibility while competition may expand.',
      common_mistake: 'Treating a proposal as final.', action_now: 'Model current and proposed status.',
      p2gc_take: 'Use the change to revisit competitive positioning.', cta: 'Federal Revenue Gap Analysis', cta_path: '/federal-revenue-gap-analysis'
    }]
  };
  const service = new P2GCBuyerLensContentService({ rootDir: root, rules: {}, outputDir: path.join(root, 'out') });
  const result = service.run({ snapshot });
  assert.equal(result.ok, true);
  assert.equal(result.totals.ready, 1);
  assert.ok(result.items[0].drafts.linkedin.includes('BUYER LENS'));
  assert.ok(result.items[0].drafts.linkedin.includes('COMMON CONTRACTOR MISTAKE'));
  assert.ok(result.items[0].drafts.intelligence_email.includes('Source:'));
  assert.equal(result.governance.officialFactSeparatedFromP2gcAnalysis, true);
  assert.equal(result.channelExecution.autoPublishPerformed, false);
  assert.ok(fs.existsSync(result.outputFile));
  console.log('P2GCBuyerLensContentService tests passed');
})();
