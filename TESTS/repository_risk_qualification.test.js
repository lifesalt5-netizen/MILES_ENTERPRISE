'use strict';

const assert = require('assert');
const RepositoryRiskQualificationService = require('../SERVICES/RepositoryRiskQualificationService');
const { confirmed } = require('../SERVICES/RepositoryRiskQualificationService');

(function testPossibleFindingsAreCandidatesNotConfirmedFailures() {
  const input = {
    components: [{ path: 'SERVICES/A.js' }],
    services: [{ path: 'SERVICES/A.js' }],
    connectors: [{ path: 'CONNECTORS/A.js' }],
    providers: [{ path: 'PROVIDERS/A.js' }],
    runtime: [{ path: 'Start.js' }],
    duplicates: [
      { risk: 'possible_duplicate_or_overlap', files: ['SERVICES/A.js','SERVICES/AB.js'] }
    ],
    orphans: [
      { risk: 'possible_orphan_static_scan_only', path: 'SERVICES/Standalone.js' }
    ],
    statistics: {}
  };
  const result = new RepositoryRiskQualificationService().qualify(input);
  assert.equal(result.duplicates.length, 0);
  assert.equal(result.orphans.length, 0);
  assert.equal(result.duplicateCandidates.length, 1);
  assert.equal(result.orphanCandidates.length, 1);
  assert.equal(result.statistics.duplicateRisks, 0);
  assert.equal(result.statistics.orphanRisks, 0);
  assert.equal(result.health.score, 100);
  assert.equal(result.health.status, 'HEALTHY');
})();

(function testConfirmedEvidenceStillScoresAsRisk() {
  const input = {
    services: [{}], connectors: [{}], providers: [{}], runtime: [{}],
    duplicates: [{ risk: 'confirmed_duplicate', confirmed: true, files: ['A','B'] }],
    orphans: [{ risk: 'confirmed_orphan', evidence: { confirmed: true }, path: 'C' }],
    statistics: {}
  };
  const result = new RepositoryRiskQualificationService().qualify(input);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.orphans.length, 1);
  assert.equal(result.health.score, 97);
  assert.equal(confirmed(result.duplicates[0]), true);
})();

console.log('REPOSITORY_RISK_QUALIFICATION_TESTS=GREEN');
