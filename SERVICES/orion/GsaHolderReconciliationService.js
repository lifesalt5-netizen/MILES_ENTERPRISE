'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

function isoNow() { return new Date().toISOString(); }
function norm(v) { return String(v || '').trim().toUpperCase(); }
function identity(record) { return norm(record.contractNumber) || norm(record.uei) || norm(record.legalBusinessName); }
function stableProjection(record) {
  return {
    contractNumber: record.contractNumber || null,
    uei: record.uei || null,
    legalBusinessName: record.legalBusinessName || null,
    currentOptionPeriodEndDate: record.currentOptionPeriodEndDate || null,
    ultimateContractEndDate: record.ultimateContractEndDate || null,
    closedForNewAwards: record.closedForNewAwards || null,
    phone: record.phone || null,
    sourceEmail: record.sourceEmail || null,
    website: record.website || null,
    city: record.city || null,
    state: record.state || null,
    categories: Array.isArray(record.categories) ? [...record.categories].sort() : []
  };
}
function sha256(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex').toUpperCase();
}
async function loadJsonl(filePath) {
  const map = new Map();
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let rows = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    rows += 1;
    const record = JSON.parse(line);
    const key = identity(record);
    if (!key) continue;
    map.set(key, record);
  }
  return { rows, map };
}
function artifactPath(manifest, name) {
  const item = (manifest.artifacts || []).find(a => path.basename(a.filePath || '') === name);
  return item?.filePath || null;
}

class GsaHolderReconciliationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.snapshotRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data', 'gsa_holder_snapshot');
    this.outputRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data', 'gsa_reconciliation');
  }

  findPriorManifest(currentManifestPath) {
    if (!fs.existsSync(this.snapshotRoot)) return null;
    const current = path.resolve(currentManifestPath);
    const manifests = [];
    for (const entry of fs.readdirSync(this.snapshotRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(this.snapshotRoot, entry.name, 'manifest.json');
      if (!fs.existsSync(candidate) || path.resolve(candidate) === current) continue;
      const stat = fs.statSync(candidate);
      manifests.push({ candidate, mtimeMs: stat.mtimeMs });
    }
    manifests.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return manifests[0]?.candidate || null;
  }

  async run(options = {}) {
    const currentManifestPath = path.resolve(options.currentManifestPath || '');
    if (!currentManifestPath || !fs.existsSync(currentManifestPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'CURRENT_GSA_MANIFEST_NOT_FOUND', currentManifestPath };
    }
    const currentManifest = JSON.parse(fs.readFileSync(currentManifestPath, 'utf8'));
    const currentPath = artifactPath(currentManifest, 'gsa_current_mas_holders.jsonl');
    if (!currentPath || !fs.existsSync(currentPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'CURRENT_GSA_HOLDER_FILE_NOT_FOUND', currentManifestPath };
    }

    const priorManifestPath = options.priorManifestPath
      ? path.resolve(options.priorManifestPath)
      : this.findPriorManifest(currentManifestPath);
    if (!priorManifestPath || !fs.existsSync(priorManifestPath)) {
      return {
        ok: false,
        status: 'BLOCKED',
        blocker: 'PRIOR_GSA_SNAPSHOT_NOT_FOUND',
        currentManifestPath,
        currentHolderPath: currentPath
      };
    }

    const priorManifest = JSON.parse(fs.readFileSync(priorManifestPath, 'utf8'));
    const priorPath = artifactPath(priorManifest, 'gsa_current_mas_holders.jsonl');
    if (!priorPath || !fs.existsSync(priorPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'PRIOR_GSA_HOLDER_FILE_NOT_FOUND', priorManifestPath };
    }

    const [current, prior] = await Promise.all([loadJsonl(currentPath), loadJsonl(priorPath)]);
    const changes = [];
    let unchanged = 0;
    for (const [key, record] of current.map.entries()) {
      const before = prior.map.get(key);
      if (!before) {
        changes.push({ type: 'NEW_HOLDER', key, current: stableProjection(record) });
        continue;
      }
      const a = JSON.stringify(stableProjection(before));
      const b = JSON.stringify(stableProjection(record));
      if (a === b) unchanged += 1;
      else changes.push({ type: 'HOLDER_CHANGED', key, prior: stableProjection(before), current: stableProjection(record) });
    }
    for (const [key, record] of prior.map.entries()) {
      if (!current.map.has(key)) changes.push({ type: 'REMOVED_OR_EXPIRED_HOLDER', key, prior: stableProjection(record) });
    }

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const runId = `GSA-RECON-${isoNow().replace(/[:.]/g, '-')}`;
    const runRoot = path.join(this.outputRoot, runId);
    fs.mkdirSync(runRoot, { recursive: false });
    const changesPath = path.join(runRoot, 'gsa_holder_changes.jsonl');
    fs.writeFileSync(changesPath, changes.map(x => JSON.stringify(x)).join('\n') + (changes.length ? '\n' : ''), 'utf8');

    const counts = {
      priorRows: prior.rows,
      currentRows: current.rows,
      priorUniqueIdentities: prior.map.size,
      currentUniqueIdentities: current.map.size,
      newHolders: changes.filter(x => x.type === 'NEW_HOLDER').length,
      removedOrExpiredHolders: changes.filter(x => x.type === 'REMOVED_OR_EXPIRED_HOLDER').length,
      changedHolders: changes.filter(x => x.type === 'HOLDER_CHANGED').length,
      unchanged
    };
    const report = {
      ok: true,
      status: 'COMPLETED',
      service: 'GsaHolderReconciliationService',
      generatedAt: isoNow(),
      currentManifestPath,
      priorManifestPath,
      inputs: {
        currentHolderPath: currentPath,
        currentHolderSha256: sha256(currentPath),
        priorHolderPath: priorPath,
        priorHolderSha256: sha256(priorPath)
      },
      counts,
      artifacts: [{ filePath: changesPath, bytes: fs.statSync(changesPath).size, sha256: sha256(changesPath) }],
      safety: { stagingOnly: true, productionOrionModified: false, instantlyModified: false }
    };
    const reportPath = path.join(runRoot, 'reconciliation_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { ...report, reportPath };
  }
}

module.exports = GsaHolderReconciliationService;
