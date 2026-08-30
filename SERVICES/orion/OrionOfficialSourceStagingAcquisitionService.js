'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { officialUsaspendingHost, freeBytesFor } = require('./OrionOfficialSourceAcquisitionPlanService');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeFileName(value) {
  const name = path.basename(String(value || ''));
  if (!name || name !== String(value || '') || !/^[A-Za-z0-9_.()\-]+$/.test(name)) throw new Error('UNSAFE_ARCHIVE_FILENAME');
  return name;
}

function requestStream(url, timeoutMs, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    if (!officialUsaspendingHost(url)) return reject(new Error('NON_OFFICIAL_DOWNLOAD_HOST'));
    const req = https.get(url, { headers: { 'user-agent': 'MILES-P2GC-ORION-STAGING-ACQUIRE/1.0' } }, res => {
      const status = Number(res.statusCode || 0);
      if ([301,302,303,307,308].includes(status)) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('TOO_MANY_REDIRECTS'));
        const next = new URL(String(res.headers.location || ''), url).toString();
        if (!officialUsaspendingHost(next)) return reject(new Error('REDIRECTED_TO_NON_OFFICIAL_HOST'));
        return requestStream(next, timeoutMs, redirectsLeft - 1).then(resolve, reject);
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`DOWNLOAD_HTTP_${status}`));
      }
      resolve({ response: res, finalUrl: url, headers: res.headers });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`DOWNLOAD_TIMEOUT_${timeoutMs}MS`)));
    req.on('error', reject);
  });
}

async function downloadOne(row, outputDir, timeoutMs) {
  const fileName = safeFileName(row.fileName);
  if (!row.ok || !row.url || !row.finalUrl || !officialUsaspendingHost(row.url) || !officialUsaspendingHost(row.finalUrl)) throw new Error(`ARCHIVE_NOT_APPROVED:${fileName}`);
  const expectedBytes = Number(row.contentLength);
  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) throw new Error(`ARCHIVE_SIZE_UNKNOWN:${fileName}`);

  fs.mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, fileName);
  const partial = `${target}.part`;
  try { fs.unlinkSync(partial); } catch {}

  const { response, finalUrl, headers } = await requestStream(row.finalUrl, timeoutMs);
  const responseLength = Number(headers['content-length']);
  if (Number.isFinite(responseLength) && responseLength !== expectedBytes) {
    response.destroy();
    throw new Error(`CONTENT_LENGTH_CHANGED:${fileName}:${expectedBytes}:${responseLength}`);
  }

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  response.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
  const out = fs.createWriteStream(partial, { flags: 'wx' });
  try {
    await pipeline(response, out);
    if (bytes !== expectedBytes) throw new Error(`DOWNLOADED_SIZE_MISMATCH:${fileName}:${expectedBytes}:${bytes}`);
    fs.renameSync(partial, target);
    return {
      role: row.role,
      fileName,
      path: target,
      sourceUrl: row.url,
      finalUrl,
      expectedBytes,
      downloadedBytes: bytes,
      sha256: hash.digest('hex'),
      etag: headers.etag || row.etag || null,
      lastModified: headers['last-modified'] || row.lastModified || null
    };
  } catch (error) {
    try { fs.unlinkSync(partial); } catch {}
    throw error;
  }
}

class OrionOfficialSourceStagingAcquisitionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.planPath = path.resolve(options.planPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_acquisition_plan.json'));
    this.reportPath = path.resolve(options.reportPath || path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_staging_acquisition.json'));
    this.timeoutMs = Math.max(30000, Number(options.timeoutMs || process.env.ORION_OFFICIAL_DOWNLOAD_TIMEOUT_MS || 30 * 60 * 1000));
  }

  async run() {
    const plan = readJson(this.planPath);
    if (plan?.ok !== true || plan?.nextStep !== 'SAFE_TO_ACQUIRE_OFFICIAL_ARCHIVES_TO_STAGING_ONLY') throw new Error('ACQUISITION_PLAN_NOT_GREEN');
    if (plan?.safety?.filesDownloaded !== false || plan?.safety?.productionDatabaseModified !== false) throw new Error('ACQUISITION_PLAN_SAFETY_CONTRACT_INVALID');
    const outputDir = path.resolve(plan.outputDir);
    const archives = Array.isArray(plan.archives) ? plan.archives : [];
    if (archives.length !== 2 || !archives.every(x => x.ok && Number.isFinite(Number(x.contentLength)))) throw new Error('EXPECTED_TWO_APPROVED_ARCHIVES');

    const required = Number(plan?.storage?.requiredReserveBytes || 0);
    const free = freeBytesFor(outputDir);
    if (!Number.isFinite(free) || free < required) throw new Error(`INSUFFICIENT_STAGING_DISK_RESERVE:${free}:${required}`);

    const downloads = [];
    for (const archive of archives) downloads.push(await downloadOne(archive, outputDir, this.timeoutMs));

    const result = {
      ok: downloads.length === 2,
      service: 'ORION_OFFICIAL_SOURCE_STAGING_ACQUISITION',
      generatedAt: new Date().toISOString(),
      outputDir,
      planGeneratedAt: plan.generatedAt || null,
      downloads,
      totalDownloadedBytes: downloads.reduce((s, x) => s + x.downloadedBytes, 0),
      nextStep: 'INSPECT_ARCHIVES_AND_BUILD_STAGING_DB_ONLY',
      safety: {
        officialHostsOnly: true,
        stagingOnly: true,
        productionDatabaseModified: false,
        stagingDatabaseCreated: false,
        stagingDatabasePromoted: false,
        existingArchiveOverwritten: false,
        destructiveGitRecovery: false
      }
    };
    fs.mkdirSync(path.dirname(this.reportPath), { recursive: true });
    fs.writeFileSync(this.reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = OrionOfficialSourceStagingAcquisitionService;
module.exports.safeFileName = safeFileName;
module.exports.requestStream = requestStream;
module.exports.downloadOne = downloadOne;
