'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;

const ProductionTruthReconciliationService = require('../SERVICES/ProductionTruthReconciliationService');

const DEFAULT_ARCHIVE_ROTATE_MIB = 384;

function isWorkQueueArchiveSerializationFailure(error) {
  const message = String(error?.message || error || '');
  const stack = String(error?.stack || '');
  return /Invalid string length/i.test(message) &&
    /WorkQueueService\.(?:writeJsonAtomic|saveArchive|archiveClosed)/i.test(stack);
}

function archiveStat(queue) {
  try {
    const stat = fs.statSync(queue.archivePath);
    return {
      path: queue.archivePath,
      exists: true,
      sizeBytes: stat.size,
      sizeMiB: Number((stat.size / 1024 / 1024).toFixed(2)),
      modifiedAt: stat.mtime.toISOString()
    };
  } catch (error) {
    return {
      path: queue.archivePath,
      exists: false,
      error: error.message
    };
  }
}

function archivePathForRoot(root = ROOT) {
  return path.join(root, 'DATA', 'runtime', 'work_queue_archive.json');
}

function archiveRotateThresholdMiB(env = process.env) {
  const parsed = Number(env.MILES_WORK_QUEUE_ARCHIVE_ROTATE_MIB);
  return Number.isFinite(parsed) && parsed >= 64
    ? parsed
    : DEFAULT_ARCHIVE_ROTATE_MIB;
}

function rotateOversizedWorkQueueArchive(root = ROOT, options = {}) {
  const archivePath = options.archivePath || archivePathForRoot(root);
  const thresholdMiB = Number(options.thresholdMiB || archiveRotateThresholdMiB(options.env || process.env));
  const thresholdBytes = thresholdMiB * 1024 * 1024;

  let stat;
  try {
    stat = fs.statSync(archivePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ok: true,
        rotated: false,
        reason: 'ARCHIVE_NOT_PRESENT',
        archivePath,
        thresholdMiB
      };
    }
    throw error;
  }

  const sizeMiB = Number((stat.size / 1024 / 1024).toFixed(2));
  if (stat.size <= thresholdBytes) {
    return {
      ok: true,
      rotated: false,
      reason: 'ARCHIVE_WITHIN_BOUND',
      archivePath,
      sizeBytes: stat.size,
      sizeMiB,
      thresholdMiB
    };
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const ext = path.extname(archivePath) || '.json';
  const base = archivePath.slice(0, archivePath.length - ext.length);
  let segmentPath = `${base}.segment_${stamp}${ext}`;
  let suffix = 1;
  while (fs.existsSync(segmentPath)) {
    segmentPath = `${base}.segment_${stamp}_${suffix}${ext}`;
    suffix += 1;
  }

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  let method = 'rename';
  try {
    fs.renameSync(archivePath, segmentPath);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EXDEV'].includes(error?.code)) throw error;
    method = 'copy-unlink';
    fs.copyFileSync(archivePath, segmentPath);
    const copied = fs.statSync(segmentPath);
    if (copied.size !== stat.size) {
      throw new Error(`WORK_QUEUE_ARCHIVE_ROTATION_COPY_SIZE_MISMATCH:${copied.size}:${stat.size}`);
    }
    fs.unlinkSync(archivePath);
  }

  fs.writeFileSync(archivePath, '[]\n', 'utf8');

  return {
    ok: true,
    rotated: true,
    reason: 'ARCHIVE_ROTATED_BEFORE_NODE_STRING_LIMIT',
    archivePath,
    segmentPath,
    method,
    preservedBytes: stat.size,
    preservedMiB: sizeMiB,
    thresholdMiB,
    historicalEvidencePreserved: true
  };
}

async function buildFailClosedFallback(service, error) {
  const WorkQueueService = require('../SERVICES/WorkQueueService');
  const CompanyStateService = require('../SERVICES/CompanyStateService');
  const queue = new WorkQueueService();
  const stats = queue.getStats();

  let registry = null;
  try {
    registry = service.reconcileRepositoryAndCapability();
  } catch (registryError) {
    registry = { ok: false, error: registryError.message };
  }

  let companyState = null;
  try {
    companyState = CompanyStateService.run({ source: 'ProductionTruthReconciliationServiceFallback' });
  } catch (companyError) {
    companyState = { ok: false, error: companyError.message };
  }

  let orion = null;
  try {
    orion = await service.auditOrion();
  } catch (orionError) {
    orion = { ok: false, status: 'AUDIT_FAILED', error: orionError.message };
  }

  const result = {
    ok: false,
    service: 'MILES_PRODUCTION_TRUTH_RECONCILIATION',
    generatedAt: new Date().toISOString(),
    degradedMode: 'WORK_QUEUE_ARCHIVE_FAIL_CLOSED',
    blocker: 'WORK_QUEUE_ARCHIVE_SERIALIZATION_FAILED',
    workQueue: {
      archival: {
        ok: false,
        archived: 0,
        blocker: 'WORK_QUEUE_ARCHIVE_SERIALIZATION_FAILED',
        errorName: error?.name || null,
        error: String(error?.message || error)
      },
      before: stats,
      after: stats,
      archiveFile: archiveStat(queue)
    },
    registry,
    companyState,
    orion,
    rules: {
      historicalFailuresPreservedInArchive: false,
      archiveFailureVisible: true,
      noFabricatedFreshness: true,
      noFalseGreenOnArchiveFailure: true
    }
  };

  const outFile = ProductionTruthReconciliationService.OUT_FILE ||
    path.join(ROOT, 'DATA', 'production_truth', 'latest_reconciliation.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

async function runReconciliation(service) {
  try {
    return await service.run({ auditOrion: true });
  } catch (error) {
    if (!isWorkQueueArchiveSerializationFailure(error)) throw error;
    console.error('[MILES] Work queue archive serialization failed; continuing in fail-closed truth mode.');
    return buildFailClosedFallback(service, error);
  }
}

function persistAugmentedResult(result) {
  const outFile = ProductionTruthReconciliationService.OUT_FILE ||
    path.join(ROOT, 'DATA', 'production_truth', 'latest_reconciliation.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
}

async function main() {
  console.log('============================================================');
  console.log('MILES PRODUCTION TRUTH RECONCILIATION');
  console.log('============================================================');
  console.log(`Root: ${ROOT}`);

  const archiveRotation = rotateOversizedWorkQueueArchive(ROOT);
  if (archiveRotation.rotated) {
    console.log(`Work queue archive rotated safely: ${archiveRotation.preservedMiB} MiB -> ${archiveRotation.segmentPath}`);
  }

  const service = new ProductionTruthReconciliationService({ rootDir: ROOT });
  const result = await runReconciliation(service);
  result.workQueue = {
    ...(result.workQueue || {}),
    archiveRotation
  };
  persistAugmentedResult(result);

  const queue = result.workQueue || {};
  const repo = result.registry?.repository || {};
  const cap = result.registry?.capability || {};
  const freshness = result.orion?.databaseFreshness || {};

  console.log(`Work queue closed archived: ${queue.archival?.archived ?? 0}`);
  console.log(`Work queue archive status: ${queue.archival?.ok === false ? 'RED' : 'OK'}`);
  if (queue.archival?.blocker) console.log(`WORK_QUEUE_ARCHIVE_BLOCKER=${queue.archival.blocker}`);
  if (queue.archiveFile?.exists) console.log(`Work queue archive size MiB: ${queue.archiveFile.sizeMiB}`);
  console.log(`Work queue archive rotated: ${archiveRotation.rotated}`);
  if (archiveRotation.rotated) console.log(`Work queue archive segment preserved MiB: ${archiveRotation.preservedMiB}`);
  console.log(`Work queue open after: ${queue.after?.open ?? 'UNKNOWN'}`);
  console.log(`Work queue failed after: ${queue.after?.failed ?? 'UNKNOWN'}`);
  console.log(`Work queue approval escalations after: ${queue.after?.escalations ?? 'UNKNOWN'}`);
  console.log(`Repository active duplicate risks: ${repo.statistics?.duplicateRisks ?? 'UNKNOWN'}`);
  console.log(`Repository active orphan risks: ${repo.statistics?.orphanRisks ?? 'UNKNOWN'}`);
  console.log(`Repository health: ${repo.health?.score ?? 'UNKNOWN'} / ${repo.health?.status ?? 'UNKNOWN'}`);
  console.log(`Capability gaps: ${cap.statistics?.gaps ?? 'UNKNOWN'}`);
  console.log(`Capability autonomy: ${cap.autonomy?.score ?? 'UNKNOWN'} / ${cap.autonomy?.status ?? 'UNKNOWN'}`);
  console.log(`Company health: ${result.companyState?.health?.score ?? 'UNKNOWN'} / ${result.companyState?.health?.status ?? 'UNKNOWN'}`);
  console.log(`ORION audit status: ${result.orion?.status ?? 'NOT_RUN'}`);
  console.log(`ORION database age hours: ${freshness.ageHours ?? 'UNKNOWN'}`);
  console.log(`ORION database stale: ${freshness.stale ?? 'UNKNOWN'}`);

  if (freshness.stale === true) {
    console.log('ORION_DATASET_REFRESH_REQUIRED=YES');
    console.log('The audit did not falsify freshness. A real source/dataset refresh is still required.');
  } else if (freshness.stale === false) {
    console.log('ORION_DATASET_REFRESH_REQUIRED=NO');
  }

  console.log(`RESULT: ${result.ok ? 'PRODUCTION_TRUTH_RECONCILIATION_GREEN' : 'PRODUCTION_TRUTH_RECONCILIATION_RED'}`);
  process.exitCode = result.ok ? 0 : 1;
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ARCHIVE_ROTATE_MIB,
  isWorkQueueArchiveSerializationFailure,
  archiveStat,
  archivePathForRoot,
  archiveRotateThresholdMiB,
  rotateOversizedWorkQueueArchive,
  buildFailClosedFallback,
  runReconciliation,
  persistAugmentedResult,
  main
};
