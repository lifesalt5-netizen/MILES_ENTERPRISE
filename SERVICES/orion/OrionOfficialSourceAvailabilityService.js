'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ENDPOINT = 'https://api.usaspending.gov/api/v2/bulk_download/list_monthly_files/';

function fiscalYearFor(date = new Date()) {
  const d = new Date(date);
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

function parseUpdatedDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T23:59:59.999Z`);
  return Number.isFinite(ms) ? ms : null;
}

function latestByUpdatedDate(rows = []) {
  return [...rows].sort((a, b) => (parseUpdatedDate(b.updated_date) || 0) - (parseUpdatedDate(a.updated_date) || 0))[0] || null;
}

function normalizeFiles(rows = []) {
  return rows
    .filter(row => row && String(row.type || '').toLowerCase() === 'contracts')
    .map(row => ({
      agency_name: row.agency_name || null,
      agency_acronym: row.agency_acronym || null,
      fiscal_year: row.fiscal_year ?? null,
      type: row.type || null,
      updated_date: row.updated_date || null,
      file_name: row.file_name || null,
      url: row.url || null,
      isFull: /_Full_/i.test(String(row.file_name || '')),
      isDelta: /_Delta_/i.test(String(row.file_name || '')),
      officialHost: (() => {
        try {
          const host = new URL(String(row.url || '')).hostname.toLowerCase();
          return host === 'files.usaspending.gov' || host.endsWith('.usaspending.gov');
        } catch { return false; }
      })()
    }));
}

function readCurrentDbMtime(rootDir) {
  const reportPath = path.join(rootDir, 'DATA', 'orion_refresh', 'latest_rebuild_readiness.json');
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const mtime = report?.current?.mtime || null;
    const ms = mtime ? Date.parse(mtime) : NaN;
    return {
      reportPath,
      path: report?.current?.path || null,
      mtime,
      mtimeMs: Number.isFinite(ms) ? ms : null
    };
  } catch {
    return { reportPath, path: null, mtime: null, mtimeMs: null };
  }
}

class OrionOfficialSourceAvailabilityService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.endpoint = options.endpoint || DEFAULT_ENDPOINT;
    this.now = options.now ? new Date(options.now) : new Date();
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs || 30000));
    this.outputPath = path.resolve(options.outputPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_availability.json'));
  }

  async run() {
    if (typeof this.fetchImpl !== 'function') throw new Error('FETCH_UNAVAILABLE');
    const fiscalYear = fiscalYearFor(this.now);
    const requestBody = { agency: 'all', fiscal_year: fiscalYear, type: 'contracts' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': 'MILES-P2GC-ORION-SOURCE-AUDIT/1.0'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error(`USASPENDING_MONTHLY_FILES_INVALID_JSON:${text.slice(0, 500)}`); }
    if (!response.ok) throw new Error(`USASPENDING_MONTHLY_FILES_HTTP_${response.status}:${JSON.stringify(payload).slice(0, 1000)}`);

    const files = normalizeFiles(Array.isArray(payload.monthly_files) ? payload.monthly_files : []);
    const official = files.filter(row => row.officialHost);
    const full = latestByUpdatedDate(official.filter(row => row.isFull && Number(row.fiscal_year) === fiscalYear));
    const delta = latestByUpdatedDate(official.filter(row => row.isDelta));
    const currentDb = readCurrentDbMtime(this.rootDir);
    const newestSourceMs = Math.max(parseUpdatedDate(full?.updated_date) || 0, parseUpdatedDate(delta?.updated_date) || 0);
    const sourceNewerThanCurrentDb = Boolean(newestSourceMs && currentDb.mtimeMs && newestSourceMs > currentDb.mtimeMs);

    const blockers = [];
    if (!full) blockers.push('FY_FULL_CONTRACT_ARCHIVE_NOT_FOUND');
    if (!delta) blockers.push('ALL_YEARS_CONTRACT_DELTA_ARCHIVE_NOT_FOUND');
    if (files.length && official.length !== files.length) blockers.push('NON_OFFICIAL_DOWNLOAD_HOST_OBSERVED');
    if (currentDb.mtimeMs && newestSourceMs && !sourceNewerThanCurrentDb) blockers.push('OFFICIAL_CONTRACT_SOURCE_NOT_NEWER_THAN_CURRENT_DB');

    const result = {
      ok: Boolean(full && delta && official.length === files.length),
      audit: 'ORION_OFFICIAL_SOURCE_AVAILABILITY',
      generatedAt: new Date().toISOString(),
      endpoint: this.endpoint,
      request: requestBody,
      fiscalYear,
      currentDb,
      summary: {
        filesReturned: files.length,
        officialFiles: official.length,
        fullArchiveFound: Boolean(full),
        deltaArchiveFound: Boolean(delta),
        newestOfficialUpdatedDate: latestByUpdatedDate(official)?.updated_date || null,
        sourceNewerThanCurrentDb,
        blockers
      },
      selected: { full, delta },
      files,
      conclusion: !full || !delta
        ? 'OFFICIAL_CONTRACT_SOURCE_INCOMPLETE'
        : currentDb.mtimeMs && !sourceNewerThanCurrentDb
          ? 'OFFICIAL_CONTRACT_SOURCE_NOT_NEWER_THAN_ORION'
          : 'CURRENT_OFFICIAL_CONTRACT_SOURCE_AVAILABLE',
      scopeBoundary: {
        sourceFamily: 'USAspending contract award archives only',
        provesFullOrionFreshness: false,
        note: 'Awards/recompete source availability does not by itself refresh ORION opportunities, SAM registry truth, recommendations, personas, or other source families.'
      },
      safety: {
        readOnlyProviderProbe: true,
        filesDownloaded: false,
        activeDatabaseModified: false,
        sourceFilesModified: false,
        providerMutation: false
      }
    };

    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = OrionOfficialSourceAvailabilityService;
module.exports.DEFAULT_ENDPOINT = DEFAULT_ENDPOINT;
module.exports.fiscalYearFor = fiscalYearFor;
module.exports.parseUpdatedDate = parseUpdatedDate;
module.exports.latestByUpdatedDate = latestByUpdatedDate;
module.exports.normalizeFiles = normalizeFiles;
module.exports.readCurrentDbMtime = readCurrentDbMtime;
