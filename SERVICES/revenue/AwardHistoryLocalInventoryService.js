'use strict';

const fs = require('fs');
const path = require('path');

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const EXTENSIONS = new Set(['.zip', '.csv', '.json', '.jsonl', '.db', '.sqlite', '.sqlite3', '.parquet']);
const AWARD_TERMS = /award|contract|usaspending|subaward|prime|recipient|vendor|orion/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.idea', '.vscode']);

function uniq(values) { return [...new Set(values.filter(Boolean).map(value => path.resolve(value)))]; }
function yearHits(text) {
  const value = String(text || '');
  return YEARS.filter(year => new RegExp(`(?:FY[ _-]?)?${year}`, 'i').test(value));
}
function candidateFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!EXTENSIONS.has(ext)) return false;
  const base = path.basename(file);
  return AWARD_TERMS.test(base) || yearHits(base).length > 0;
}

class AwardHistoryLocalInventoryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.maxFilesVisited = Number(options.maxFilesVisited || 350000);
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue_universe');
    this.outputPath = path.join(this.outputDir, 'latest_local_award_history_inventory.json');
    this.roots = uniq(options.roots || [
      process.env.P2GC_INTELLIGENCE_ROOT,
      'D:\\P2GC_Intelligence',
      'C:\\P2GC_Intelligence',
      path.dirname(this.rootDir)
    ]).filter(root => fs.existsSync(root));
  }

  walk(root, state, out) {
    if (state.visited >= this.maxFilesVisited) return;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (state.visited >= this.maxFilesVisited) break;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) this.walk(full, state, out);
        continue;
      }
      if (!entry.isFile()) continue;
      state.visited += 1;
      if (!candidateFile(full)) continue;
      let stat = null;
      try { stat = fs.statSync(full); } catch {}
      const years = yearHits(full);
      out.push({
        file: full,
        extension: path.extname(full).toLowerCase(),
        bytes: stat ? stat.size : null,
        modifiedAt: stat ? stat.mtime.toISOString() : null,
        yearHints: years,
        awardTermHint: AWARD_TERMS.test(path.basename(full))
      });
    }
  }

  run() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const state = { visited: 0 };
    const candidates = [];
    for (const root of this.roots) this.walk(root, state, candidates);
    const byYear = Object.fromEntries(YEARS.map(year => [String(year), []]));
    const unscoped = [];
    for (const item of candidates) {
      if (!item.yearHints.length) unscoped.push(item);
      for (const year of item.yearHints) byYear[String(year)].push(item);
    }
    const report = {
      ok: true,
      status: state.visited >= this.maxFilesVisited ? 'LOCAL_AWARD_HISTORY_INVENTORY_PARTIAL_LIMIT_REACHED' : 'LOCAL_AWARD_HISTORY_INVENTORY_COMPLETE',
      generatedAt: new Date().toISOString(),
      rootsSearched: this.roots,
      filesVisited: state.visited,
      candidateFiles: candidates.length,
      fiscalYears: Object.fromEntries(YEARS.map(year => [String(year), {
        candidateCount: byYear[String(year)].length,
        candidates: byYear[String(year)]
      }])),
      unscopedAwardCandidates: unscoped,
      nextRule: 'VALIDATE_AND_REUSE_EXISTING_LOCAL_ARTIFACTS_BEFORE_ANY_REACQUISITION',
      safety: {
        readOnlyFilesystemScan: true,
        filesModified: false,
        productionOrionModified: false,
        providerMutation: false,
        campaignMutation: false,
        emailSent: false
      }
    };
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = AwardHistoryLocalInventoryService;
module.exports.yearHits = yearHits;
module.exports.candidateFile = candidateFile;
