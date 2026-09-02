'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const BaseService = require('./FederalSourceReadinessAuditService');
const SamBulkExtractAcquisitionService = require('./SamBulkExtractAcquisitionService');

const ENTITY_DOMAIN = 'Entity%20Registration/Public%20V2';
const ENTITY_DOWNLOAD_BASE = `https://sam.gov/api/prod/fileextractservices/v1/api/download/${ENTITY_DOMAIN}`;

function probeHead(url, timeoutMs = 20000) {
  return new Promise(resolve => {
    let settled = false;
    const started = Date.now();
    const done = value => {
      if (settled) return;
      settled = true;
      resolve({ ...value, durationMs: Date.now() - started });
    };
    const req = https.request(url, {
      method: 'HEAD',
      headers: { 'user-agent': 'MILES-P2GC-FEDERAL-SOURCE-READINESS/1.5' }
    }, res => {
      res.resume();
      res.on('end', () => done({
        ok: res.statusCode >= 200 && res.statusCode < 400,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'] || null,
        contentLength: Number(res.headers['content-length'] || 0) || null,
        location: res.headers.location || null,
        errorHint: null
      }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error', error => done({
      ok: false,
      statusCode: null,
      contentType: null,
      contentLength: null,
      location: null,
      errorHint: error.message
    }));
    req.end();
  });
}

async function deterministicEntityHeadFallback(now = new Date(), timeoutMs = 20000, count = 8) {
  const attempts = [];
  for (const name of SamBulkExtractAcquisitionService.candidateEntityNames(now, count)) {
    const url = `${ENTITY_DOWNLOAD_BASE}/${encodeURIComponent(name)}?privacy=Public`;
    const head = await probeHead(url, timeoutMs);
    attempts.push({ name, url, ...head });
    if (head.ok) {
      return {
        ok: true,
        latestFile: {
          displayKey: name,
          dateModified: null,
          size: head.contentLength,
          downloadUrl: url
        },
        head,
        attempts,
        discoveryMethod: 'DETERMINISTIC_FIRST_SUNDAY_OFFICIAL_DOWNLOAD_HEAD_FALLBACK'
      };
    }
  }
  return {
    ok: false,
    latestFile: null,
    head: null,
    attempts,
    discoveryMethod: 'DETERMINISTIC_FIRST_SUNDAY_OFFICIAL_DOWNLOAD_HEAD_FALLBACK'
  };
}

class FederalSourceReadinessAuditServiceV2 {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.now = options.now ? new Date(options.now) : new Date();
    this.timeoutMs = Math.max(5000, Number(options.timeoutMs || 20000));
    this.base = new BaseService({ ...options, rootDir: this.rootDir, now: this.now, timeoutMs: this.timeoutMs });
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_federal_source_readiness.json');
  }

  async run() {
    const result = await this.base.run();
    const entity = result?.samBulk?.entityRegistration;
    if (!entity || entity.ready === true) return result;

    const fallback = await deterministicEntityHeadFallback(this.now, this.timeoutMs, 8);
    entity.deterministicOfficialFilenameFallback = {
      used: true,
      ok: fallback.ok,
      discoveryMethod: fallback.discoveryMethod,
      attempts: fallback.attempts.map(item => ({
        name: item.name,
        ok: item.ok,
        statusCode: item.statusCode,
        contentType: item.contentType,
        contentLength: item.contentLength,
        location: item.location || null,
        errorHint: item.errorHint || null
      }))
    };

    if (fallback.ok) {
      entity.discoveryMethod = fallback.discoveryMethod;
      entity.latestFile = fallback.latestFile;
      entity.downloadHead = {
        ok: fallback.head.ok,
        statusCode: fallback.head.statusCode,
        contentType: fallback.head.contentType,
        contentLength: fallback.head.contentLength,
        location: fallback.head.location || null,
        errorHint: fallback.head.errorHint || null
      };
      entity.ready = true;
      result.blockers = (result.blockers || []).filter(x => x !== 'SAM_ENTITY_PUBLIC_BULK_EXTRACT_NOT_DISCOVERED_OR_NOT_REACHABLE');
      result.ok = result.blockers.length === 0;
      result.nextStep = result.ok
        ? 'ACQUIRE_AND_STAGE_SAM_PUBLIC_ENTITY_AND_OPPORTUNITY_BULK_EXTRACTS'
        : result.nextStep;
    }

    result.service = 'FEDERAL_SOURCE_READINESS_AUDIT';
    result.version = '1.5';
    result.safety = {
      ...(result.safety || {}),
      deterministicOfficialDownloadHeadFallback: true,
      deterministicFallbackDownloadsPerformed: false,
      productionDatabaseModified: false,
      credentialsModified: false
    };
    result.safety.requestsMade = Number(result.safety.requestsMade || 0) + fallback.attempts.length;

    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = FederalSourceReadinessAuditServiceV2;
module.exports.deterministicEntityHeadFallback = deterministicEntityHeadFallback;
module.exports.probeHead = probeHead;
