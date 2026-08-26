'use strict';

// CI trigger note: this existing covered test path is intentionally touched so
// the repository's established pull_request workflows validate the ORION
// rebuild-readiness pack under the same gates used by prior remediation PRs.
const assert = require('assert');
const {
  isHistoricalPath,
  filterRepositoryRegistry,
  patchRepositoryAwareness
} = require('../SERVICES/ProductionTruthReconciliationService');

function section(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
    throw error;
  }
}

section('historical build and backup paths are excluded from active risk scoring', () => {
  for (const path of [
    '_LEGACY_BUILDS/BUILD_037/SERVICES/WorkQueueService.js',
    '_BACKUPS/BUILD_022/SERVICES/OrionProvider.js',
    '_REGISTRY_CONVERGENCE_20260710_193412/SERVICES/RepositoryRegistryService.js',
    'runtime/governance_final_backup_20260712003240/SERVICES/WorkQueueService.js',
    'SERVICES/WorkQueueService.Build034Backup_20260713_120306.js',
    'SERVICES/WorkQueueService.BeforeBuild034_20260713_130722.js',
    'SERVICES/BuilderService.previous.js',
    'SERVICES/WorkQueueService.js.replacement_20732_1783816243015'
  ]) assert.equal(isHistoricalPath(path), true, `${path} must be historical`);

  assert.equal(isHistoricalPath('SERVICES/WorkQueueService.js'), false);
  assert.equal(isHistoricalPath('SERVICES/RepositoryRegistryService.js'), false);
});

section('repository truth keeps active components and removes historical-only duplicate/orphan risks', () => {
  const active = { id: 'active', path: 'SERVICES/WorkQueueService.js', name: 'WorkQueueService.js', componentTypes: ['service'], owner: 'Service Layer' };
  const historical = { id: 'old', path: '_LEGACY_BUILDS/X/SERVICES/WorkQueueService.js', name: 'WorkQueueService.js', componentTypes: ['service'], owner: 'Service Layer' };
  const connector = { id: 'con', path: 'CONNECTORS/ORION/connector.js', name: 'connector.js', componentTypes: ['connector'], owner: 'ORION' };
  const provider = { id: 'prov', path: 'PROVIDERS/providers/OrionProvider.js', name: 'OrionProvider.js', componentTypes: ['provider'], owner: 'ORION' };
  const runtime = { id: 'run', path: 'CORE/Runtime.js', name: 'Runtime.js', componentTypes: ['runtime'], owner: 'Runtime' };
  const input = {
    files: [active, historical, connector, provider, runtime],
    components: [active, historical, connector, provider, runtime],
    services: [active, historical], workers: [], providers: [provider], connectors: [connector], runtime: [runtime], apis: [], databases: [],
    events: { allEvents: [] },
    duplicates: [
      { files: [active.path, historical.path] },
      { files: ['SERVICES/AService.js', 'SERVICES/AServiceV2.js'] }
    ],
    orphans: [
      { path: historical.path },
      { path: 'SERVICES/RealOrphanService.js' }
    ],
    statistics: { totalFiles: 5, events: 0 }
  };

  const out = filterRepositoryRegistry(input);
  assert.equal(out.components.some(x => x.path === historical.path), false);
  assert.equal(out.statistics.duplicateRisks, 1);
  assert.equal(out.statistics.orphanRisks, 1);
  assert.equal(out.productionTruth.excludedFromActiveRiskScoring.components, 1);
  assert.equal(out.productionTruth.excludedFromActiveRiskScoring.duplicateRisks, 1);
  assert.equal(out.productionTruth.excludedFromActiveRiskScoring.orphanRisks, 1);
  assert.equal(out.productionTruth.historicalEvidencePreservedInRepositoryFiles, true);
});

section('repository awareness gap closes only when current production registry evidence exists', () => {
  const repo = {
    components: [{
      id: 'repo-service',
      path: 'SERVICES/RepositoryRegistryService.js',
      name: 'RepositoryRegistryService.js',
      componentTypes: ['service'],
      owner: 'Engineering',
      dependencies: [],
      events: {},
      status: 'active_candidate'
    }]
  };
  const capability = {
    capabilities: [
      { id: 'coo_orchestration', executable: true, autonomyImpact: 'CRITICAL', governance: { requiresApproval: false } },
      { id: 'revenue_operations', executable: true, autonomyImpact: 'HIGH', governance: { requiresApproval: false } },
      { id: 'self_learning_operations', executable: true, autonomyImpact: 'HIGH', governance: { requiresApproval: false } }
    ],
    gaps: [{ capabilityId: 'repository_awareness', severity: 'HIGH' }],
    ownerMap: {},
    executionMap: {},
    statistics: {}
  };

  const out = patchRepositoryAwareness(capability, repo);
  assert(out.capabilities.some(x => x.id === 'repository_awareness' && x.executable === true));
  assert.equal(out.gaps.some(x => x.capabilityId === 'repository_awareness'), false);
  assert(out.productionTruth.repositoryAwarenessEvidence.includes('SERVICES/RepositoryRegistryService.js'));
  assert.equal(out.statistics.gaps, 0);
});

section('repository awareness is not fabricated without evidence', () => {
  const capability = { capabilities: [], gaps: [{ capabilityId: 'repository_awareness' }], ownerMap: {}, executionMap: {}, statistics: {} };
  const out = patchRepositoryAwareness(capability, { components: [] });
  assert.equal(out.capabilities.some(x => x.id === 'repository_awareness'), false);
  assert.equal(out.gaps.length, 1);
});

console.log('PRODUCTION_TRUTH_RECONCILIATION=GREEN');
