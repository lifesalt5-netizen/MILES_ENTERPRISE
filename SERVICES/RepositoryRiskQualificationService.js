'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const REGISTRY_FILE = path.join(ROOT, 'DATA', 'repository', 'repository_registry.json');
const HEALTH_FILE = path.join(ROOT, 'DATA', 'repository', 'repository_health.json');
const STATS_FILE = path.join(ROOT, 'DATA', 'repository', 'repository_statistics.json');

function arr(v) { return Array.isArray(v) ? v : []; }
function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(tmp, file); }
  catch { fs.copyFileSync(tmp, file); try { fs.unlinkSync(tmp); } catch {} }
}
function confirmed(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.confirmed === true || row.evidence?.confirmed === true) return true;
  const risk = String(row.risk || '').toLowerCase();
  const confidence = String(row.confidence || '').toUpperCase();
  return risk.startsWith('confirmed_') || (confidence === 'HIGH' && arr(row.evidence).length > 0);
}
function health(registry) {
  const duplicateRisks = arr(registry.duplicates).length;
  const orphanRisks = arr(registry.orphans).length;
  let score = 100;
  score -= Math.min(20, duplicateRisks * 2);
  score -= Math.min(20, orphanRisks);
  if (!arr(registry.runtime).length) score -= 15;
  if (!arr(registry.services).length) score -= 15;
  if (!arr(registry.connectors).length) score -= 10;
  if (!arr(registry.providers).length) score -= 10;
  score = Math.max(0, score);
  return {
    score,
    status: score >= 90 ? 'HEALTHY' : score >= 75 ? 'WATCH' : score >= 50 ? 'NEEDS_ATTENTION' : 'CRITICAL',
    summary: {
      duplicateRisks,
      orphanRisks,
      duplicateCandidates: arr(registry.duplicateCandidates).length,
      orphanCandidates: arr(registry.orphanCandidates).length,
      hasRuntime: arr(registry.runtime).length > 0,
      hasServices: arr(registry.services).length > 0,
      hasConnectors: arr(registry.connectors).length > 0,
      hasProviders: arr(registry.providers).length > 0
    }
  };
}

class RepositoryRiskQualificationService {
  qualify(input = null) {
    const registry = JSON.parse(JSON.stringify(input || readJson(REGISTRY_FILE, {})));
    const rawDuplicates = arr(registry.duplicateCandidates).length
      ? arr(registry.duplicateCandidates)
      : arr(registry.duplicates);
    const rawOrphans = arr(registry.orphanCandidates).length
      ? arr(registry.orphanCandidates)
      : arr(registry.orphans);

    const actionableDuplicates = rawDuplicates.filter(confirmed);
    const actionableOrphans = rawOrphans.filter(confirmed);
    const unverifiedDuplicates = rawDuplicates.filter(row => !confirmed(row));
    const unverifiedOrphans = rawOrphans.filter(row => !confirmed(row));

    registry.duplicateCandidates = rawDuplicates;
    registry.orphanCandidates = rawOrphans;
    registry.duplicates = actionableDuplicates;
    registry.orphans = actionableOrphans;
    registry.statistics = {
      ...(registry.statistics || {}),
      duplicateRisks: actionableDuplicates.length,
      orphanRisks: actionableOrphans.length,
      duplicateCandidates: rawDuplicates.length,
      orphanCandidates: rawOrphans.length,
      unverifiedDuplicateCandidates: unverifiedDuplicates.length,
      unverifiedOrphanCandidates: unverifiedOrphans.length
    };
    registry.riskQualification = {
      qualifiedAt: new Date().toISOString(),
      policy: 'UNVERIFIED_STATIC_CANDIDATES_DO_NOT_REDUCE_OPERATIONAL_HEALTH',
      candidateEvidencePreserved: true,
      actionable: {
        duplicateRisks: actionableDuplicates.length,
        orphanRisks: actionableOrphans.length
      },
      unverified: {
        duplicateCandidates: unverifiedDuplicates.length,
        orphanCandidates: unverifiedOrphans.length
      },
      note: 'RepositoryRegistryService labels these findings possible_duplicate_or_overlap and possible_orphan_static_scan_only. They remain visible for engineering review but are not scored as confirmed production failures without corroborating evidence.'
    };
    registry.health = health(registry);

    return registry;
  }

  run() {
    const registry = this.qualify();
    writeJson(REGISTRY_FILE, registry);
    writeJson(HEALTH_FILE, registry.health);
    writeJson(STATS_FILE, registry.statistics);
    return {
      ok: true,
      action: 'REPOSITORY_RISK_QUALIFICATION',
      generatedAt: registry.riskQualification.qualifiedAt,
      health: registry.health,
      statistics: registry.statistics,
      qualification: registry.riskQualification
    };
  }
}

module.exports = RepositoryRiskQualificationService;
module.exports.confirmed = confirmed;
module.exports.health = health;
