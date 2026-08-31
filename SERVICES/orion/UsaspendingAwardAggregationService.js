'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const csv = require('csv-parser');

function isoNow() { return new Date().toISOString(); }
function norm(v) { return String(v || '').trim().toUpperCase(); }
function num(v) {
  const n = Number(String(v ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}
function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function valueByAliases(row, aliases) {
  const lookup = new Map(Object.keys(row || {}).map(k => [normalizedKey(k), row[k]]));
  for (const alias of aliases) {
    const value = lookup.get(normalizedKey(alias));
    if (value !== undefined && String(value).trim() !== '') return value;
  }
  return '';
}
function artifactPath(manifest, basename) {
  const item = (manifest?.artifacts || []).find(a => path.basename(a.filePath || '') === basename);
  return item?.filePath || null;
}
function ensureInside(parent, candidate) {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path escaped staging root: ${target}`);
  return target;
}
function classifyCsv(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('subaward')) return 'SUBAWARD';
  return 'PRIME_AWARD';
}
function recursivelyListCsv(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...recursivelyListCsv(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) out.push(full);
  }
  return out;
}

class UsaspendingAwardAggregationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.stagingRoot = path.join(this.rootDir, 'DATA', 'staging', 'government_data');
    this.outputRoot = path.join(this.stagingRoot, 'usaspending_aggregation');
  }

  extract(zipPath, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const tar = spawnSync('tar', ['-xf', zipPath, '-C', targetDir], { encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true });
    if (tar.status === 0) return { tool: 'tar', stderr: tar.stderr || '' };

    if (process.platform === 'win32') {
      const escapedZip = zipPath.replace(/'/g, "''");
      const escapedTarget = targetDir.replace(/'/g, "''");
      const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedTarget}' -Force`], {
        encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true
      });
      if (ps.status === 0) return { tool: 'Expand-Archive', stderr: ps.stderr || '' };
      throw new Error(`USAspending ZIP extraction failed. tar=${String(tar.stderr || '').slice(0, 300)} powershell=${String(ps.stderr || '').slice(0, 300)}`);
    }
    throw new Error(`USAspending ZIP extraction failed: ${String(tar.stderr || '').slice(0, 500)}`);
  }

  async aggregateCsv(filePath, totals, agencyTotals, counters) {
    const level = classifyCsv(filePath);
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', row => {
          counters.rows += 1;
          if (level === 'SUBAWARD') counters.subawardRows += 1;
          else counters.primeAwardRows += 1;

          const uei = norm(valueByAliases(row, ['recipient_uei', 'Recipient UEI', 'recipient_unique_entity_identifier']));
          if (!uei) { counters.rowsWithoutUei += 1; return; }

          const awardId = norm(valueByAliases(row, ['award_id_piid', 'Award ID', 'piid', 'generated_unique_award_id']));
          const parentAwardId = norm(valueByAliases(row, ['parent_award_id_piid', 'Parent Award ID', 'parent_award_id']));
          const obligation = num(valueByAliases(row, [
            'federal_action_obligation', 'Federal Action Obligation', 'subaward_amount', 'Subaward Amount',
            'total_obligation', 'Total Obligation', 'current_total_value_of_award'
          ]));
          const agency = norm(valueByAliases(row, ['awarding_agency_name', 'Awarding Agency', 'awarding_sub_agency_name', 'funding_agency_name'])) || 'UNKNOWN';

          let item = totals.get(uei);
          if (!item) {
            item = { uei, primeFederalObligations: 0, subawardObligations: 0, awardRows: 0, contractRefs: {} };
            totals.set(uei, item);
          }
          if (level === 'SUBAWARD') item.subawardObligations += obligation;
          else item.primeFederalObligations += obligation;
          item.awardRows += 1;
          for (const ref of [awardId, parentAwardId].filter(Boolean)) {
            item.contractRefs[ref] = Number(item.contractRefs[ref] || 0) + obligation;
          }
          if (!agencyTotals.has(uei)) agencyTotals.set(uei, {});
          const agencies = agencyTotals.get(uei);
          agencies[agency] = Number(agencies[agency] || 0) + obligation;
        })
        .on('error', reject)
        .on('end', resolve);
    });
  }

  async run(options = {}) {
    const manifestPath = path.resolve(options.usaspendingManifestPath || '');
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'USASPENDING_MANIFEST_NOT_FOUND', manifestPath };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const zipPath = artifactPath(manifest, 'usaspending_prime_and_subawards.zip');
    if (!zipPath || !fs.existsSync(zipPath)) {
      return { ok: false, status: 'BLOCKED', blocker: 'USASPENDING_ZIP_NOT_FOUND', manifestPath };
    }

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const runId = `USASPENDING-AGG-${isoNow().replace(/[:.]/g, '-')}`;
    const runRoot = ensureInside(this.outputRoot, path.join(this.outputRoot, runId));
    const extractRoot = path.join(runRoot, 'extracted');
    fs.mkdirSync(runRoot, { recursive: false });
    const extraction = this.extract(zipPath, extractRoot);
    const csvFiles = recursivelyListCsv(extractRoot);
    if (!csvFiles.length) {
      return { ok: false, status: 'BLOCKED', blocker: 'USASPENDING_ZIP_CONTAINED_NO_CSV', runRoot, extraction };
    }

    const totals = new Map();
    const agencyTotals = new Map();
    const counters = { files: csvFiles.length, rows: 0, primeAwardRows: 0, subawardRows: 0, rowsWithoutUei: 0 };
    for (const filePath of csvFiles) await this.aggregateCsv(filePath, totals, agencyTotals, counters);

    const outputPath = path.join(runRoot, 'award_aggregates_by_uei.jsonl');
    const lines = [];
    for (const [uei, item] of totals.entries()) {
      const agencies = agencyTotals.get(uei) || {};
      const agencyEntries = Object.entries(agencies).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const totalAgencyObligation = agencyEntries.reduce((sum, [, value]) => sum + value, 0);
      const top = agencyEntries[0] || [null, 0];
      lines.push(JSON.stringify({
        ...item,
        totalFederalObligations: item.primeFederalObligations + item.subawardObligations,
        topAwardingAgency: top[0],
        topAwardingAgencyObligations: top[1],
        topAgencyShare: totalAgencyObligation ? Math.abs(top[1]) / Math.max(1, Math.abs(totalAgencyObligation)) : 0
      }));
    }
    fs.writeFileSync(outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

    const report = {
      ok: true,
      status: 'COMPLETED',
      service: 'UsaspendingAwardAggregationService',
      generatedAt: isoNow(),
      sourceManifestPath: manifestPath,
      sourceZipPath: zipPath,
      extraction,
      counts: { ...counters, uniqueUeis: totals.size },
      artifacts: [{ filePath: outputPath, bytes: fs.statSync(outputPath).size }],
      safety: { stagingOnly: true, productionOrionModified: false, instantlyModified: false }
    };
    const reportPath = path.join(runRoot, 'aggregation_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { ...report, reportPath, aggregatePath: outputPath };
  }
}

module.exports = UsaspendingAwardAggregationService;
