'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = ROOT;

const WorkQueueService = require('./WorkQueueService');
const WorkQueueReconciliationService = require('./WorkQueueReconciliationService');
const CapabilityRegistryService = require('./CapabilityRegistryService');
const CompanyStateService = require('./CompanyStateService');
const OrionProvider = require('../PROVIDERS/providers/OrionProvider');

const REPOSITORY_FILE = path.join(ROOT, 'DATA', 'repository', 'repository_registry.json');
const CAPABILITY_FILE = path.join(ROOT, 'DATA', 'capability', 'capability_registry.json');
const OUT_DIR = path.join(ROOT, 'DATA', 'production_truth');
const OUT_FILE = path.join(OUT_DIR, 'latest_reconciliation.json');

function now() { return new Date().toISOString(); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); try { fs.unlinkSync(tmp); } catch {} }
}

function normalizedPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function isHistoricalPath(value) {
  const p = normalizedPath(value);
  if (!p) return false;

  const segments = p.split('/').filter(Boolean);
  if (segments.some(segment =>
    segment === '_legacy_builds' ||
    segment === '_backups' ||
    segment === 'backups' ||
    segment === 'miles_backups' ||
    segment === 'archive' ||
    segment.startsWith('_registry_convergence_') ||
    segment.includes('governance_final_backup_') ||
    segment.includes('work_queue_governance_backup_')
  )) return true;

  const name = segments[segments.length - 1] || '';
  return (
    /(?:^|[._-])backup(?:[._-]|$)/i.test(name) ||
    /build\d+backup_/i.test(name) ||
    /beforebuild\d+/i.test(name) ||
    /\.previous\./i.test(name) ||
    /\.replacement_/i.test(name) ||
    /_source_bundle\.txt$/i.test(name) ||
    /_required_source\.txt$/i.test(name)
  );
}

function repositoryHealth(registry) {
  let score = 100;
  score -= Math.min(20, arr(registry.duplicates).length * 2);
  score -= Math.min(20, arr(registry.orphans).length);
  if (!arr(registry.runtime).length) score -= 15;
  if (!arr(registry.services).length) score -= 15;
  if (!arr(registry.connectors).length) score -= 10;
  if (!arr(registry.providers).length) score -= 10;
  score = Math.max(0, score);
  return {
    score,
    status: score >= 90 ? 'HEALTHY' : score >= 75 ? 'WATCH' : score >= 50 ? 'NEEDS_ATTENTION' : 'CRITICAL',
    summary: {
      duplicateRisks: arr(registry.duplicates).length,
      orphanRisks: arr(registry.orphans).length,
      hasRuntime: arr(registry.runtime).length > 0,
      hasServices: arr(registry.services).length > 0,
      hasConnectors: arr(registry.connectors).length > 0,
      hasProviders: arr(registry.providers).length > 0
    }
  };
}

function filterRepositoryRegistry(input) {
  const registry = JSON.parse(JSON.stringify(input || {}));
  const before = {
    components: arr(registry.components).length,
    duplicateRisks: arr(registry.duplicates).length,
    orphanRisks: arr(registry.orphans).length
  };

  const keep = row => !isHistoricalPath(row?.path);
  const filterList = key => { registry[key] = arr(registry[key]).filter(keep); };

  for (const key of ['components','services','workers','providers','connectors','runtime','apis','databases']) {
    filterList(key);
  }

  registry.duplicates = arr(registry.duplicates).filter(row =>
    arr(row?.files).length > 0 && arr(row.files).every(file => !isHistoricalPath(file))
  );
  registry.orphans = arr(registry.orphans).filter(row => !isHistoricalPath(row?.path));

  const stats = obj(registry.statistics);
  registry.statistics = {
    ...stats,
    totalComponents: arr(registry.components).length,
    services: arr(registry.services).length,
    workers: arr(registry.workers).length,
    providers: arr(registry.providers).length,
    connectors: arr(registry.connectors).length,
    runtime: arr(registry.runtime).length,
    apis: arr(registry.apis).length,
    databases: arr(registry.databases).length,
    duplicateRisks: arr(registry.duplicates).length,
    orphanRisks: arr(registry.orphans).length
  };
  registry.health = repositoryHealth(registry);
  registry.productionTruth = {
    reconciledAt: now(),
    scope: 'ACTIVE_PRODUCTION_ONLY',
    historicalEvidencePreservedInRepositoryFiles: true,
    excludedFromActiveRiskScoring: {
      components: before.components - registry.statistics.totalComponents,
      duplicateRisks: before.duplicateRisks - registry.statistics.duplicateRisks,
      orphanRisks: before.orphanRisks - registry.statistics.orphanRisks
    }
  };
  return registry;
}

function autonomyScore(capabilities, gaps) {
  let score = 100;
  score -= Math.min(35, gaps.length * 5);
  const executable = capabilities.filter(c => c.executable).length;
  const ratio = executable / (capabilities.length || 1);
  if (ratio < 0.5) score -= 20;
  else if (ratio < 0.75) score -= 10;
  if (!capabilities.some(c => c.id === 'coo_orchestration')) score -= 15;
  if (!capabilities.some(c => c.id === 'revenue_operations')) score -= 10;
  if (!capabilities.some(c => c.id === 'self_learning_operations')) score -= 10;
  score = Math.max(0, score);
  return {
    score,
    status: score >= 90 ? 'AUTONOMY_READY' : score >= 75 ? 'STRONG' : score >= 60 ? 'PARTIAL' : 'NEEDS_BUILD',
    executableRatio: ratio,
    totalCapabilities: capabilities.length,
    executableCapabilities: executable,
    gaps: gaps.length
  };
}

function patchRepositoryAwareness(input, repository) {
  const registry = JSON.parse(JSON.stringify(input || {}));
  registry.capabilities = arr(registry.capabilities);
  registry.gaps = arr(registry.gaps);

  const evidence = arr(repository?.components).filter(component =>
    /(^|\/)services\/repositoryregistryservice\.js$/i.test(String(component?.path || '')) ||
    /repository.*registry/i.test(String(component?.name || ''))
  );

  if (!evidence.length) return registry;

  let capability = registry.capabilities.find(c => c.id === 'repository_awareness');
  if (!capability) {
    capability = {
      id: 'repository_awareness',
      name: 'Repository Awareness',
      category: 'Engineering',
      description: 'Authoritative inventory and production-aware repository introspection.',
      owners: ['Engineering'],
      components: evidence.map(component => ({
        componentId: component.id,
        path: component.path,
        name: component.name,
        componentTypes: component.componentTypes,
        owner: component.owner,
        dependencies: component.dependencies || [],
        events: component.events || {},
        status: component.status
      })),
      executable: true,
      governance: { requiresApproval: false, level: 'AUTONOMOUS_READ_ONLY' },
      autonomyImpact: 'HIGH',
      reducesKevinWorkload: true,
      status: 'EXECUTABLE_CANDIDATE',
      componentCount: evidence.length,
      primaryOwner: evidence[0]?.owner || 'Engineering'
    };
    registry.capabilities.push(capability);
  }

  registry.gaps = registry.gaps.filter(gap => gap.capabilityId !== 'repository_awareness');
  registry.ownerMap = obj(registry.ownerMap);
  registry.executionMap = obj(registry.executionMap);
  registry.ownerMap.Engineering = arr(registry.ownerMap.Engineering).filter(x => x.capabilityId !== 'repository_awareness');
  registry.ownerMap.Engineering.push({
    capabilityId: 'repository_awareness',
    name: 'Repository Awareness',
    executable: true,
    componentCount: evidence.length
  });
  registry.executionMap.repository_awareness = {
    capability: 'Repository Awareness',
    executable: true,
    primaryOwner: capability.primaryOwner,
    governance: capability.governance,
    autonomyImpact: capability.autonomyImpact,
    candidateExecutors: evidence.map(component => ({
      path: component.path,
      name: component.name,
      componentTypes: component.componentTypes,
      owner: component.owner
    }))
  };

  const capabilities = registry.capabilities;
  const gaps = registry.gaps;
  registry.statistics = {
    ...obj(registry.statistics),
    totalCapabilities: capabilities.length,
    executableCapabilities: capabilities.filter(c => c.executable).length,
    discoveredOnlyCapabilities: capabilities.filter(c => !c.executable).length,
    highAutonomyImpact: capabilities.filter(c => ['HIGH','CRITICAL'].includes(c.autonomyImpact)).length,
    governanceApprovalRequired: capabilities.filter(c => c.governance?.requiresApproval).length,
    gaps: gaps.length
  };
  registry.autonomy = autonomyScore(capabilities, gaps);
  registry.productionTruth = {
    ...(registry.productionTruth || {}),
    reconciledAt: now(),
    repositoryAwarenessEvidence: evidence.map(x => x.path)
  };
  return registry;
}

class ProductionTruthReconciliationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || ROOT);
    process.env.MILES_ROOT = this.rootDir;
  }

  reconcileWorkQueue() {
    const reconciliation = new WorkQueueReconciliationService().reconcile();
    const queue = new WorkQueueService();
    const before = queue.getStats();
    const archival = queue.archiveClosed();
    const afterQueue = new WorkQueueService();
    const after = afterQueue.getStats();
    return { reconciliation, archival, before, after };
  }

  reconcileRepositoryAndCapability() {
    const repository = readJson(REPOSITORY_FILE, null);
    if (!repository) return { ok: false, reason: 'REPOSITORY_REGISTRY_MISSING' };

    const filtered = filterRepositoryRegistry(repository);
    atomicWrite(REPOSITORY_FILE, filtered);

    let capabilityBuild = null;
    try { capabilityBuild = new CapabilityRegistryService().run(); }
    catch (error) { capabilityBuild = { ok: false, error: error.message }; }

    const capability = readJson(CAPABILITY_FILE, null);
    if (!capability) {
      return { ok: false, reason: 'CAPABILITY_REGISTRY_MISSING', repository: filtered.productionTruth, capabilityBuild };
    }

    const patchedCapability = patchRepositoryAwareness(capability, filtered);
    atomicWrite(CAPABILITY_FILE, patchedCapability);

    return {
      ok: true,
      repository: {
        health: filtered.health,
        statistics: filtered.statistics,
        productionTruth: filtered.productionTruth
      },
      capability: {
        autonomy: patchedCapability.autonomy,
        statistics: patchedCapability.statistics,
        gaps: patchedCapability.gaps
      },
      capabilityBuild
    };
  }

  async auditOrion() {
    const provider = new OrionProvider();
    const result = await provider.auditIntelligence();
    return {
      ok: result.ok,
      status: result.status,
      generatedAt: result.generatedAt,
      databaseFreshness: result.metrics?.databaseFreshness || null,
      exceptions: result.exceptions || [],
      recommendations: result.recommendations || [],
      safety: result.safety || null
    };
  }

  async run(options = {}) {
    const startedAt = Date.now();
    const workQueue = this.reconcileWorkQueue();
    const registry = this.reconcileRepositoryAndCapability();

    let companyState = null;
    try { companyState = CompanyStateService.run({ source: 'ProductionTruthReconciliationService' }); }
    catch (error) { companyState = { ok: false, error: error.message }; }

    let orion = null;
    if (options.auditOrion !== false) {
      try { orion = await this.auditOrion(); }
      catch (error) { orion = { ok: false, status: 'AUDIT_FAILED', error: error.message }; }
    }

    const result = {
      ok: Boolean(registry?.ok && companyState?.ok !== false),
      service: 'MILES_PRODUCTION_TRUTH_RECONCILIATION',
      generatedAt: now(),
      durationMs: Date.now() - startedAt,
      workQueue,
      registry,
      companyState,
      orion,
      rules: {
        historicalFailuresPreservedInArchive: true,
        historicalRepositoryArtifactsExcludedFromActiveRiskScoring: true,
        noFabricatedFreshness: true,
        orionDatabaseStalenessRemainsVisibleUntilDatasetActuallyRefreshes: true
      }
    };

    atomicWrite(OUT_FILE, result);
    return result;
  }
}

module.exports = ProductionTruthReconciliationService;
module.exports.isHistoricalPath = isHistoricalPath;
module.exports.filterRepositoryRegistry = filterRepositoryRegistry;
module.exports.patchRepositoryAwareness = patchRepositoryAwareness;
module.exports.repositoryHealth = repositoryHealth;
module.exports.OUT_FILE = OUT_FILE;
