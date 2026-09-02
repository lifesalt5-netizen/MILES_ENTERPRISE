'use strict';

const https = require('https');

const OFFICIAL_HOST = 'sam.gov';
const ENTITY_DOWNLOAD_BASE = 'https://sam.gov/api/prod/fileextractservices/v1/api/download/Entity%20Registration/Public%20V2/';

function yyyymmdd(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function monthlyCandidateDates(now = new Date(), monthsBack = 6, maxDay = 10) {
  const current = new Date(now);
  const out = [];
  for (let monthOffset = 0; monthOffset < monthsBack; monthOffset += 1) {
    const monthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - monthOffset, 1));
    for (let day = 1; day <= maxDay; day += 1) {
      const candidate = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day));
      if (candidate.getUTCMonth() !== monthStart.getUTCMonth()) continue;
      if (candidate.getTime() > current.getTime()) continue;
      out.push(candidate);
    }
  }
  return out.sort((a, b) => b.getTime() - a.getTime());
}

function buildCandidate(date) {
  const stamp = yyyymmdd(date);
  const fileName = `SAM_PUBLIC_UTF-8_MONTHLY_V2_${stamp}.ZIP`;
  const downloadUrl = `${ENTITY_DOWNLOAD_BASE}${encodeURIComponent(fileName)}?privacy=Public`;
  return { stamp, fileName, downloadUrl };
}

function defaultHead(url, timeoutMs = 20000) {
  return new Promise(resolve => {
    const started = Date.now();
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      resolve({ ...value, durationMs: Date.now() - started });
    };
    let parsed;
    try { parsed = new URL(url); }
    catch (error) { return done({ ok: false, statusCode: null, errorHint: error.message }); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== OFFICIAL_HOST) {
      return done({ ok: false, statusCode: null, errorHint: 'NON_OFFICIAL_SAM_HOST_BLOCKED' });
    }
    const req = https.request(parsed, {
      method: 'HEAD',
      headers: { 'user-agent': 'MILES-P2GC-SAM-PUBLIC-MONTHLY-PROBE/1.0' }
    }, res => {
      res.resume();
      res.on('end', () => done({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'] || null,
        contentLength: Number(res.headers['content-length'] || 0) || null,
        location: res.headers.location || null,
        errorHint: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : null
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error', error => done({ ok: false, statusCode: null, contentType: null, contentLength: null, location: null, errorHint: error.message }));
    req.end();
  });
}

class SamEntityPublicBulkFilenameProbeFallbackService {
  constructor(options = {}) {
    this.now = options.now ? new Date(options.now) : new Date();
    this.monthsBack = Math.max(2, Number(options.monthsBack || 6));
    this.maxDay = Math.min(15, Math.max(7, Number(options.maxDay || 10)));
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs || 20000));
    this.head = options.head || defaultHead;
  }

  async run() {
    const candidates = monthlyCandidateDates(this.now, this.monthsBack, this.maxDay).map(buildCandidate);
    const attempts = [];
    for (const candidate of candidates) {
      const probe = await this.head(candidate.downloadUrl, this.timeoutMs);
      attempts.push({
        fileName: candidate.fileName,
        statusCode: probe?.statusCode ?? null,
        ok: probe?.ok === true,
        contentType: probe?.contentType || null,
        contentLength: probe?.contentLength ?? null,
        errorHint: probe?.errorHint || null
      });
      if (probe?.ok === true) {
        return {
          ok: true,
          ready: true,
          service: 'SAM_ENTITY_PUBLIC_BULK_FILENAME_PROBE_FALLBACK',
          discoveryMethod: 'OFFICIAL_SAM_MONTHLY_FILENAME_HEAD_PROBE',
          latestFile: {
            displayKey: candidate.fileName,
            dateModified: null,
            size: probe.contentLength ?? null,
            downloadUrl: candidate.downloadUrl
          },
          downloadHead: {
            ok: true,
            statusCode: probe.statusCode,
            contentType: probe.contentType || null,
            contentLength: probe.contentLength ?? null,
            location: probe.location || null,
            errorHint: null
          },
          attempts: attempts.length,
          attemptedFiles: attempts,
          officialHostOnly: true,
          generatedAt: new Date().toISOString()
        };
      }
    }
    return {
      ok: false,
      ready: false,
      service: 'SAM_ENTITY_PUBLIC_BULK_FILENAME_PROBE_FALLBACK',
      discoveryMethod: 'OFFICIAL_SAM_MONTHLY_FILENAME_HEAD_PROBE',
      latestFile: null,
      downloadHead: null,
      attempts: attempts.length,
      attemptedFiles: attempts,
      officialHostOnly: true,
      generatedAt: new Date().toISOString(),
      blocker: 'NO_REACHABLE_UTF8_MONTHLY_PUBLIC_V2_EXTRACT_FOUND_IN_BOUNDED_DATE_WINDOW'
    };
  }
}

module.exports = SamEntityPublicBulkFilenameProbeFallbackService;
module.exports.monthlyCandidateDates = monthlyCandidateDates;
module.exports.buildCandidate = buildCandidate;
module.exports.defaultHead = defaultHead;
