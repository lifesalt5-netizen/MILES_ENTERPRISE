'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P2GCCompetitorExperimentService = require('../SERVICES/revenue/P2GCCompetitorExperimentService');

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-ci-'));
  const outputDir = path.join(root, 'out');
  const rules = {
    governance: { source_url_required: true, observation_date_required: true },
    experiment_priority: { min_confidence: 0.7, min_impact_score: 3, max_open_experiments: 6 },
    experiment_kpis: ['qualified_reply_rate', 'revenue_per_1000_delivered']
  };
  const snapshot = {
    review_date: '2026-08-23',
    findings: [
      {
        id: 'A', competitor: 'Competitor A', category: 'LEAD_MAGNET', source_url: 'https://example.com/a', observed_at: '2026-08-23',
        observation: 'Uses a free diagnostic.', confidence: 0.95, impact_score: 5, decision: 'TEST', p2gc_action: 'Test a diagnostic CTA.',
        experiment_variable: 'cta_entry_mechanism', experiment_hypothesis: 'Diagnostic CTA improves qualified conversion.'
      },
      {
        id: 'B', competitor: 'Competitor B', category: 'PRICING', source_url: 'https://example.com/b', observed_at: '2026-08-23',
        observation: 'Shows pricing.', confidence: 0.9, impact_score: 4, decision: 'TEST', p2gc_action: 'Test pricing visibility without reducing approved prices.',
        experiment_variable: 'pricing_visibility', experiment_hypothesis: 'Visibility improves qualification.'
      },
      {
        id: 'C', competitor: 'Competitor C', category: 'PROOF', source_url: 'https://example.com/c', observed_at: '2026-08-23',
        observation: 'Uses aggressive proof.', confidence: 0.9, impact_score: 5, decision: 'AVOID', p2gc_action: 'Do not use unsupported proof.',
        experiment_variable: null, experiment_hypothesis: null
      }
    ]
  };

  const service = new P2GCCompetitorExperimentService({ rootDir: root, rules, outputDir });
  const result = service.run({ snapshot });
  assert.equal(result.ok, true);
  assert.equal(result.totals.findingsAccepted, 3);
  assert.equal(result.totals.experimentsCreated, 2);
  assert.equal(result.totals.readyForTest, 1);
  assert.equal(result.totals.awaitingCeoApproval, 1);
  assert.equal(result.experiments.find(x => x.source_finding_id === 'A').status, 'READY_FOR_TEST');
  assert.equal(result.experiments.find(x => x.source_finding_id === 'B').status, 'AWAITING_CEO_APPROVAL');
  assert.ok(fs.existsSync(result.outputFile));

  console.log('P2GCCompetitorExperimentService tests passed');
})();
