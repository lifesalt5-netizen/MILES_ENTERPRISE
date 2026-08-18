"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_SOURCES = 20;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".csv", ".json", ".jsonl", ".ndjson"]);

function clean(value) {
  return String(value ?? "").trim().replace(/^"|"$/g, "");
}

function isArchivePath(value) {
  return /(?:^|[\\/])(?:_?archive(?:_old)?|backups?|legacy)(?:[\\/]|$)/i.test(clean(value));
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function sourceScore(filePath) {
  const text = clean(filePath).toLowerCase();
  const name = path.basename(text);
  let score = 0;

  if (/has[_ -]?email|email[_ -]?ready/.test(name)) score += 12;
  if (/with[_ -]?contacts?|contacts?/.test(name)) score += 10;
  if (/verified/.test(name)) score += 9;
  if (/ready[_ -]?to[_ -]?send|outreach[_ -]?ready/.test(name)) score += 8;
  if (/leads?/.test(name)) score += 7;
  if (/prospects?/.test(name)) score += 6;
  if (/master/.test(name)) score += 3;
  if (/segmented/.test(name)) score += 2;

  if (/consolidation of leads/.test(text)) score += 4;
  if (/sam_registry/.test(text)) score += 3;
  if (/orion_core/.test(text)) score += 2;
  if (isArchivePath(text)) score -= 50;

  return score;
}

class CaptureCapacitySourceBootstrapService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.env = options.env || process.env;
    this.maxSources = Math.max(1, Number(options.maxSources || DEFAULT_MAX_SOURCES));
    this.maxFileBytes = Math.max(1, Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES));
    this.includeArchives = options.includeArchives === true;
    this.indexFiles = Array.isArray(options.indexFiles)
      ? options.indexFiles
      : [
          path.join(this.rootDir, "SEGMENT_FILE_DISCOVERY.csv"),
          path.join(this.rootDir, "_LEGACY_BUILDS", "inventory", "data_sources.csv")
        ];
    this.reportFile = options.reportFile || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "capture_capacity",
      "source_bootstrap_latest.json"
    );
  }

  explicitSources() {
    return clean(this.env.CAPTURE_CAPACITY_CONTACT_SOURCES)
      .split(path.delimiter)
      .map(clean)
      .filter(Boolean);
  }

  readIndex(indexFile) {
    if (!fs.existsSync(indexFile)) return [];

    const text = fs.readFileSync(indexFile, "utf8").replace(/^\uFEFF/, "");
    const rows = text.split(/\r?\n/).filter(line => clean(line));
    const paths = [];

    for (const line of rows) {
      for (const value of splitCsvLine(line)) {
        const candidate = clean(value);
        if (!candidate || /^fullname$|^path$|^file$|^source/i.test(candidate)) continue;
        if (!/[\\/]/.test(candidate)) continue;
        paths.push(candidate);
      }
    }

    return paths;
  }

  evaluateCandidate(candidate) {
    const filePath = clean(candidate);
    const extension = path.extname(filePath).toLowerCase();
    const archived = isArchivePath(filePath);

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return { filePath, accepted: false, reason: "UNSUPPORTED_EXTENSION", archived };
    }

    if (archived && !this.includeArchives) {
      return { filePath, accepted: false, reason: "ARCHIVE_EXCLUDED", archived };
    }

    if (!fs.existsSync(filePath)) {
      return { filePath, accepted: false, reason: "FILE_NOT_FOUND", archived };
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      return { filePath, accepted: false, reason: "STAT_FAILED", archived, error: error.message };
    }

    if (!stat.isFile()) {
      return { filePath, accepted: false, reason: "NOT_A_FILE", archived };
    }

    if (stat.size > this.maxFileBytes) {
      return {
        filePath,
        accepted: false,
        reason: "FILE_TOO_LARGE",
        archived,
        sizeBytes: stat.size,
        maxFileBytes: this.maxFileBytes
      };
    }

    return {
      filePath,
      accepted: true,
      archived,
      sizeBytes: stat.size,
      score: sourceScore(filePath)
    };
  }

  writeReport(report) {
    fs.mkdirSync(path.dirname(this.reportFile), { recursive: true });
    const temporary = `${this.reportFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2), "utf8");
    fs.renameSync(temporary, this.reportFile);
    return this.reportFile;
  }

  apply() {
    const explicit = this.explicitSources();

    if (explicit.length > 0) {
      const report = {
        ok: true,
        status: "EXPLICIT_CONTACT_SOURCES_PRESERVED",
        mode: "EXPLICIT",
        selectedCount: explicit.length,
        selectedSources: explicit,
        indexFilesChecked: [],
        generatedAt: new Date().toISOString()
      };
      report.artifact = this.writeReport(report);
      return report;
    }

    const indexed = [];
    const indexFilesChecked = [];

    for (const indexFile of this.indexFiles) {
      const exists = fs.existsSync(indexFile);
      const rows = exists ? this.readIndex(indexFile) : [];
      indexFilesChecked.push({ indexFile, exists, discoveredPaths: rows.length });
      indexed.push(...rows);
    }

    const deduplicated = [];
    const seen = new Set();

    for (const candidate of indexed) {
      const key = clean(candidate).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduplicated.push(candidate);
    }

    const evaluated = deduplicated.map(candidate => this.evaluateCandidate(candidate));
    const selected = evaluated
      .filter(item => item.accepted)
      .sort((a, b) => {
        const scoreDifference = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDifference !== 0) return scoreDifference;
        return Number(a.sizeBytes || 0) - Number(b.sizeBytes || 0);
      })
      .slice(0, this.maxSources);

    if (selected.length > 0) {
      this.env.CAPTURE_CAPACITY_CONTACT_SOURCES = selected
        .map(item => item.filePath)
        .join(path.delimiter);
    }

    const rejectionCounts = {};
    for (const item of evaluated.filter(item => !item.accepted)) {
      rejectionCounts[item.reason] = Number(rejectionCounts[item.reason] || 0) + 1;
    }

    const report = {
      ok: selected.length > 0,
      status: selected.length > 0
        ? "CONTACT_SOURCES_BOOTSTRAPPED"
        : "NO_EXTERNAL_CONTACT_SOURCES_FOUND",
      mode: "AUTO_INDEX",
      selectedCount: selected.length,
      selectedSources: selected.map(item => ({
        filePath: item.filePath,
        sizeBytes: item.sizeBytes,
        score: item.score
      })),
      indexedPathCount: deduplicated.length,
      evaluatedCount: evaluated.length,
      rejectionCounts,
      indexFilesChecked,
      maxSources: this.maxSources,
      maxFileBytes: this.maxFileBytes,
      includeArchives: this.includeArchives,
      generatedAt: new Date().toISOString()
    };

    report.artifact = this.writeReport(report);
    return report;
  }
}

module.exports = new CaptureCapacitySourceBootstrapService();
module.exports.CaptureCapacitySourceBootstrapService = CaptureCapacitySourceBootstrapService;
module.exports.helpers = {
  clean,
  isArchivePath,
  splitCsvLine,
  sourceScore,
  SUPPORTED_EXTENSIONS
};
