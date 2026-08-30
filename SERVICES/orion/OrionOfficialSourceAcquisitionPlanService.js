'use strict';

const fs = require('fs');
const path = require('path');
const OrionOfficialSourceAvailabilityService = require('./OrionOfficialSourceAvailabilityService');

function officialUsaspendingHost(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    return host === 'files.usaspending.gov' || host.endsWith('.usaspending.gov');
  } catch { return false; }
}

function freeBytesFor(targetPath) {
  try {
    const root = path.parse(path.resolve(targetPath)).root || targetPath;
    if (typeof fs.statfsSync !== 'function') return null;
    const stat = fs.statfsSync(root);
    const bavail = Number(stat.bavail ?? stat.bfree ?? 0);
    const bsize = Number(stat.bsize ?? stat.frsize ?? 0);
    const value = bavail * bsize;
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch { return null; }
}

async function headProbe(fetchImpl, url, timeoutMs) {
  if (!officialUsaspendingHost(url)) {
    return { ok: false, url, reason: 'NON_OFFICIAL_DOWNLOAD_HOST', contentLength: null };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'user-agent': 'MILES-P2GC-ORION-ACQUISITION-PLAN/1.0' },
      signal: controller.signal
    });
    const finalUrl = response.url || url;
    if (!officialUsaspendingHost(finalUrl)) {
      return { ok: false, url, finalUrl, reason: 'REDIRECTED_TO_NON_OFFICIAL_HOST', status: response.status, contentLength: null };
    }
    const lengthRaw = response.headers?.get?.('content-length');
    const length = Number(lengthRaw);
    return {
      ok: response.ok,
      url,
      finalUrl,
      status: response.status,
      contentType: response.headers?.get?.('content-type') || null,
      contentLength: Number.isFinite(length) && length >= 0 ? length : null,
      etag: response.headers?.get?.('etag') || null,
      lastModified: response.headers?.get?.('last-modified') || null,
      acceptRanges: response.headers?.get?.('accept-ranges') || null,
      reason: response.ok ? null : `HEAD_HTTP_${response.status}`
    };
  } catch (error) {
    return { ok: false, url, reason: `HEAD_PROBE_FAILED:${error.name || 'ERROR'}:${error.message}`, contentLength: null };
  } finally {
    clearTimeout(timer);
  }
}

class OrionOfficialSourceAcquisitionPlanService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.outputDir = path.resolve(options.outputDir || path.join(this.rootDir, 'DATA', 'orion_refresh', 'official_source_staging'));
    this.reportPath = path.resolve(options.reportPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_acquisition_plan.json'));
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs || 30000));
    this.maxSingleFileBytes = Math.max(1024 * 1024, Number(options.maxSingleFileBytes || process.env.ORION_OFFICIAL_SOURCE_MAX_SINGLE_FILE_BYTES || 20 * 1024 * 1024 * 1024));
    this.reserveMultiplier = Math.max(1.25, Number(options.reserveMultiplier || process.env.ORION_OFFICIAL_SOURCE_RESERVE_MULTIPLIER || 1.75));
  }

  async run() {
    if (typeof this.fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
    const availability = await new OrionOfficialSourceAvailabilityService({
      rootDir: this.rootDir,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs
    }).run();

    const selected = [
      ['full', availability?.selected?.full],
      ['delta', availability?.selected?.delta]
    ].filter(([, row]) => row?.url);

    const probes = [];
    for (const [role, row] of selected) {
      probes.push({ role, fileName: row.file_name || null, updatedDate: row.updated_date || null, ...(await headProbe(this.fetchImpl, row.url, this.timeoutMs)) });
    }

    const freeBytes = freeBytesFor(this.outputDir);
    const knownBytes = probes.reduce((sum, row) => sum + (Number.isFinite(row.contentLength) ? row.contentLength : 0), 0);
    const allSizesKnown = probes.length === 2 && probes.every(row => Number.isFinite(row.contentLength));
    const headOk = probes.length === 2 && probes.every(row => row.ok === true);
    const oversized = probes.filter(row => Number.isFinite(row.contentLength) && row.contentLength > this.maxSingleFileBytes);
    const requiredReserveBytes = allSizesKnown ? Math.ceil(knownBytes * this.reserveMultiplier) : null;

    const blockers = [];
    if (availability?.ok !== true) blockers.push('OFFICIAL_SOURCE_AVAILABILITY_NOT_GREEN');
    if (!headOk) blockers.push('OFFICIAL_ARCHIVE_HEAD_PROBE_NOT_GREEN');
    if (!allSizesKnown) blockers.push('OFFICIAL_ARCHIVE_SIZE_UNKNOWN');
    if (oversized.length) blockers.push('OFFICIAL_ARCHIVE_EXCEEDS_SINGLE_FILE_LIMIT');
    if (requiredReserveBytes != null && freeBytes != null && freeBytes < requiredReserveBytes) blockers.push('INSUFFICIENT_STAGING_DISK_RESERVE');
    if (freeBytes == null) blockers.push('STAGING_FREE_DISK_UNKNOWN');

    const result = {
      ok: blockers.length === 0,
      service: 'ORION_OFFICIAL_SOURCE_ACQUISITION_PLAN',
      generatedAt: new Date().toISOString(),
      stagingOnly: true,
      outputDir: this.outputDir,
      sourceAvailability: {
        ok: availability?.ok === true,
        fiscalYear: availability?.fiscalYear ?? null,
        conclusion: availability?.conclusion || null,
        sourceNewerThanCurrentDb: availability?.summary?.sourceNewerThanCurrentDb ?? null
      },
      archives: probes,
      storage: {
        freeBytes,
        knownArchiveBytes: knownBytes,
        allArchiveSizesKnown: allSizesKnown,
        reserveMultiplier: this.reserveMultiplier,
        requiredReserveBytes,
        maxSingleFileBytes: this.maxSingleFileBytes
      },
      blockers,
      nextStep: blockers.length === 0
        ? 'SAFE_TO_ACQUIRE_OFFICIAL_ARCHIVES_TO_STAGING_ONLY'
        : 'RESOLVE_ACQUISITION_PLAN_BLOCKERS_BEFORE_DOWNLOAD',
      scopeBoundary: {
        sourceFamily: 'USAspending contract award archives only',
        provesFullOrionFreshness: false,
        note: 'This plan does not download data, rebuild ORION, modify production, or prove opportunity/SAM/recommendation/persona freshness.'
      },
      safety: {
        headRequestsOnly: true,
        filesDownloaded: false,
        productionDatabaseModified: false,
        stagingDatabaseCreated: false,
        stagingDatabasePromoted: false,
        destructiveGitRecovery: false
      }
    };

    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = OrionOfficialSourceAcquisitionPlanService;
module.exports.officialUsaspendingHost = officialUsaspendingHost;
module.exports.freeBytesFor = freeBytesFor;
module.exports.headProbe = headProbe;
