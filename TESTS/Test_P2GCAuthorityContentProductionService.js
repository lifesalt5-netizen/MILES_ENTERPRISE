'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P2GCAuthorityContentProductionService = require('../SERVICES/revenue/P2GCAuthorityContentProductionService');

(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-authority-'));
  const schedule = {
    items: [
      { id: 'METH', date: '2026-08-24', theme: 'GSA shelfware', linkedin_title: 'Test', video_title: 'Test video', cta: 'Diagnostic', evidence_mode: 'METHODOLOGY' },
      { id: 'CASE-FALLBACK', date: '2026-08-25', theme: 'GSA proof', linkedin_title: 'Case', video_title: 'Case video', email_title: 'Case email', cta: 'Diagnostic', evidence_mode: 'CASE_STUDY', proof_id: 'P1', fallback_mode: 'METHODOLOGY_ONLY' },
      { id: 'CASE-BLOCK', date: '2026-08-26', theme: 'Proof', linkedin_title: 'Case 2', cta: 'Diagnostic', evidence_mode: 'CASE_STUDY', proof_id: 'P2' },
      { id: 'DATA', date: '2026-08-27', theme: 'Report', asset_type: 'DEEP_ASSET', title: 'Report', cta: 'Score', evidence_mode: 'INTERNAL_DATA_REQUIRED' }
    ]
  };
  const proof = {
    candidates: [
      { id: 'P1', status: 'EVIDENCE_REQUIRED', public_use: 'BLOCKED', permission_status: 'UNKNOWN' },
      { id: 'P2', status: 'EVIDENCE_REQUIRED', public_use: 'BLOCKED', permission_status: 'UNKNOWN' }
    ],
    approved: []
  };
  const service = new P2GCAuthorityContentProductionService({ rootDir: root, schedule, proof, outputDir: path.join(root, 'out') });
  const result = service.produce({ now: new Date('2026-08-23T15:00:00Z'), horizonDays: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.totals.items, 4);
  assert.equal(result.totals.ready, 2);
  assert.equal(result.totals.blocked, 2);
  assert.equal(result.totals.proofFallbacks, 1);
  assert.equal(result.items.find(x => x.id === 'METH').production_status, 'READY_METHODOLOGY');
  assert.ok(result.items.find(x => x.id === 'METH').drafts.linkedin.includes('GSA Schedule'));
  assert.equal(result.items.find(x => x.id === 'CASE-FALLBACK').production_status, 'READY_METHODOLOGY_FALLBACK');
  assert.ok(result.items.find(x => x.id === 'CASE-FALLBACK').drafts.linkedin);
  assert.equal(result.items.find(x => x.id === 'CASE-BLOCK').publication_status, 'BLOCKED');
  assert.equal(result.items.find(x => x.id === 'DATA').publication_status, 'BLOCKED');
  assert.equal(result.channelExecution.linkedinConnectorAvailable, false);
  assert.equal(result.governance.proofRegistryEnforced, true);
  assert.ok(fs.existsSync(result.outputFile));

  const approvedProof = {
    candidates: [],
    approved: [{ id: 'P2', status: 'APPROVED', public_use: 'APPROVED', permission_status: 'ANONYMIZED_USE_APPROVED' }]
  };
  const service2 = new P2GCAuthorityContentProductionService({ rootDir: root, schedule, proof: approvedProof, outputDir: path.join(root, 'out2') });
  const result2 = service2.produce({ now: new Date('2026-08-23T15:00:00Z'), horizonDays: 10 });
  assert.equal(result2.items.find(x => x.id === 'CASE-BLOCK').production_status, 'READY_PROOF_APPROVED');

  console.log('P2GCAuthorityContentProductionService tests passed');
})();
