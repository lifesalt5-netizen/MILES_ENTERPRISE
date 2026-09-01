'use strict';

const fs = require('fs');
const path = require('path');
const UsaspendingAwardHistoryStagingService = require('../UsaspendingAwardHistoryStagingService');

const COUNT_ENDPOINT = 'https://api.usaspending.gov/api/v2/download/count/';
const DEFAULT_START_DATE = '2025-10-01';
const DEFAULT_TARGET_ROWS = 425000;

function isoNow() { return new Date().toISOString(); }
function isoDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString().slice(0, 10);
}
function addDays(value, days) {
  const date = new Date(`${isoDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function midpoint(startDate, endDate) {
  const start = Date.parse(`${isoDate(startDate)}T00:00:00Z`);
  const end = Date.parse(`${isoDate(endDate)}T00:00:00Z`);
  const days = Math.floor((end - start) / 86400000);
  return addDays(startDate, Math.floor(days / 2));
}
function monthPartitions(startDate, endDate) {
  const start = isoDate(startDate);
  const end = isoDate(endDate);
  const out = [];
  let cursor = start;
  while (cursor <= end) {
    const current = new Date(`${cursor}T00:00:00Z`);
    const nextMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
    const monthEnd = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
    const partitionEnd = monthEnd < end ? monthEnd : end;
    out.push({ startDate: cursor, endDate: partitionEnd, planningAuthority: 'MONTHLY_FALLBACK' });
    cursor = addDays(partitionEnd, 1);
  }
  return out;
}

class UsaspendingPartitionedAwardHistoryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.staging = options.staging || new UsaspendingAwardHistoryStagingService({ root: this.rootDir });
    this.targetRows = Number(options.targetRows || process.env.P2GC_USASPENDING_PARTITION_TARGET_ROWS || DEFAULT_TARGET_ROWS);
    this.startDate = isoDate(options.startDate || process.env.P2GC_AWARDED_UNIVERSE_START_DATE || DEFAULT_START_DATE);
    this.endDate = isoDate(options.endDate || process.env.P2GC_AWARDED_UNIVERSE_END_DATE || new Date());
    this.outputRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data', 'usaspending_awards_partitioned');
  }

  async countRange(startDate, endDate) {
    const resolved = this.staging.resolveOptions({ startDate, endDate });
    const request = this.staging.requestPayload(resolved);
    const response = await this.staging.requestJson(COUNT_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: request.filters })
    });
    const count = Number(response?.calculated_transaction_count);
    const maximum = Number(response?.maximum_transaction_limit || 500000);
    if (!Number.isFinite(count) || count < 0) throw new Error('USASPENDING_COUNT_RESPONSE_MISSING_TRANSACTION_COUNT');
    return {
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      calculatedTransactionCount: count,
      maximumTransactionLimit: Number.isFinite(maximum) ? maximum : 500000,
      transactionRowsGtLimit: response?.transaction_rows_gt_limit === true,
      messages: Array.isArray(response?.messages) ? response.messages : []
    };
  }

  async planRange(startDate, endDate, depth = 0) {
    if (depth > 20) throw new Error('USASPENDING_PARTITION_DEPTH_EXCEEDED');
    const count = await this.countRange(startDate, endDate);
    const mustSplit = count.transactionRowsGtLimit || count.calculatedTransactionCount > Math.min(this.targetRows, count.maximumTransactionLimit - 1);
    if (!mustSplit) return [{ ...count, planningAuthority: 'USASPENDING_DOWNLOAD_COUNT' }];
    if (count.startDate === count.endDate) {
      throw new Error(`USASPENDING_SINGLE_DAY_EXCEEDS_SAFE_DOWNLOAD_LIMIT:${count.startDate}:${count.calculatedTransactionCount}`);
    }
    const middle = midpoint(count.startDate, count.endDate);
    const rightStart = addDays(middle, 1);
    const left = await this.planRange(count.startDate, middle, depth + 1);
    const right = await this.planRange(rightStart, count.endDate, depth + 1);
    return [...left, ...right];
  }

  async plan() {
    if (this.endDate < this.startDate) throw new Error('USASPENDING_PARTITION_END_BEFORE_START');
    try {
      const partitions = await this.planRange(this.startDate, this.endDate);
      return { ok: true, authority: 'USASPENDING_DOWNLOAD_COUNT', partitions, countPreflightAvailable: true, error: null };
    } catch (error) {
      const message = String(error.message || error);
      if (message.startsWith('USASPENDING_SINGLE_DAY_EXCEEDS_SAFE_DOWNLOAD_LIMIT')) throw error;
      return {
        ok: true,
        authority: 'MONTHLY_FALLBACK_AFTER_COUNT_PREFLIGHT_FAILURE',
        partitions: monthPartitions(this.startDate, this.endDate),
        countPreflightAvailable: false,
        error: message
      };
    }
  }

  reusableManifest(startDate, endDate) {
    const root = this.staging.outputRoot;
    if (!fs.existsSync(root)) return null;
    const candidates = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest?.ok !== true || manifest?.status !== 'COMPLETED') continue;
        if (manifest?.inputs?.startDate !== startDate || manifest?.inputs?.endDate !== endDate) continue;
        const zip = (manifest.artifacts || []).find(item => path.basename(item?.filePath || '') === 'usaspending_prime_and_subawards.zip')?.filePath;
        if (!zip || !fs.existsSync(zip)) continue;
        const stamp = Date.parse(manifest.generatedAt || '') || fs.statSync(manifestPath).mtimeMs;
        candidates.push({ manifestPath, manifest, stamp });
      } catch {}
    }
    candidates.sort((a, b) => b.stamp - a.stamp);
    return candidates[0] || null;
  }

  async stage() {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const plan = await this.plan();
    const stagedPartitions = [];
    for (let index = 0; index < plan.partitions.length; index += 1) {
      const partition = plan.partitions[index];
      const reusable = this.reusableManifest(partition.startDate, partition.endDate);
      if (reusable) {
        stagedPartitions.push({
          ...partition,
          reused: true,
          manifestPath: reusable.manifestPath,
          sourceGeneratedAt: reusable.manifest.generatedAt || null,
          reportedRows: reusable.manifest.download?.reportedRows ?? null
        });
        continue;
      }
      const runId = `USASPENDING-AWARDED-PART-${partition.startDate}-TO-${partition.endDate}-${Date.now()}-${index + 1}`;
      const staged = await this.staging.refresh({ startDate: partition.startDate, endDate: partition.endDate, runId });
      if (staged?.ok !== true || staged?.status !== 'COMPLETED' || !staged?.manifestPath) {
        throw new Error(`USASPENDING_PARTITION_STAGING_FAILED:${partition.startDate}:${partition.endDate}`);
      }
      stagedPartitions.push({
        ...partition,
        reused: false,
        manifestPath: staged.manifestPath,
        sourceGeneratedAt: staged.generatedAt || null,
        reportedRows: staged.download?.reportedRows ?? null
      });
    }

    const runId = `USASPENDING-AWARDED-PARTITIONED-${this.startDate}-TO-${this.endDate}-${isoNow().replace(/[:.]/g, '-')}`;
    const runRoot = path.join(this.outputRoot, runId);
    fs.mkdirSync(runRoot, { recursive: true });
    const manifestPath = path.join(runRoot, 'manifest.json');
    const manifest = {
      ok: true,
      status: 'COMPLETED',
      service: 'UsaspendingPartitionedAwardHistoryService',
      generatedAt: isoNow(),
      authority: 'USAspending.gov',
      requestedRange: { startDate: this.startDate, endDate: this.endDate },
      partitionPlanning: {
        authority: plan.authority,
        targetRows: this.targetRows,
        countPreflightAvailable: plan.countPreflightAvailable,
        countPreflightError: plan.error || null,
        partitionCount: stagedPartitions.length
      },
      partitions: stagedPartitions,
      safety: {
        officialSourceReadsOnly: true,
        stagingOnly: true,
        productionOrionModified: false,
        currentMasterModified: false,
        instantlyModified: false,
        campaignModified: false,
        emailsSent: false
      }
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { ...manifest, manifestPath };
  }
}

module.exports = UsaspendingPartitionedAwardHistoryService;
module.exports.monthPartitions = monthPartitions;
