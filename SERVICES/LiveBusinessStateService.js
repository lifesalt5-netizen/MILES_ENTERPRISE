"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

const COLLECTIONS = [
  "campaigns",
  "replies",
  "mailboxes",
  "segments",
  "deals",
  "proposals",
  "opportunities",
  "contractors"
];

const FILE_HINTS = {
  campaigns: [
    "campaign",
    "campaigns",
    "instantly",
    "outbound"
  ],

  replies: [
    "reply",
    "replies",
    "latest_replies",
    "response",
    "responses",
    "lead_response",
    "lead_responses",
    "inbox",
    "message",
    "messages"
  ],

  mailboxes: [
    "mailbox",
    "mailboxes",
    "account_health",
    "sending_account",
    "sending_accounts"
  ],

  segments: [
    "segment",
    "segments",
    "segment_inventory",
    "outreach_segment"
  ],

  deals: [
    "pipeline",
    "deals",
    "crm"
  ],

  proposals: [
    "proposal",
    "pursuit",
    "submission"
  ],

  opportunities: [
    "opportunity",
    "bid_board",
    "orion"
  ],

  contractors: [
    "contractor",
    "vendor",
    "company"
  ]
};

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function safeReadJson(file) {
  try {
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "");

    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeWriteJson(file, value) {
  try {
    ensureDir(path.dirname(file));

    const tempFile =
      `${file}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
      tempFile,
      JSON.stringify(value, null, 2),
      "utf8"
    );

    try {
      fs.renameSync(tempFile, file);
    } catch {
      fs.copyFileSync(tempFile, file);
      fs.unlinkSync(tempFile);
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeRows(value, collectionName) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const direct = value[collectionName];

  if (Array.isArray(direct)) {
    return direct;
  }

  const business = value.business;

  if (
    business &&
    Array.isArray(business[collectionName])
  ) {
    return business[collectionName];
  }

  const data = value.data;

  if (Array.isArray(data)) {
    return data;
  }

  if (
    data &&
    Array.isArray(data[collectionName])
  ) {
    return data[collectionName];
  }

  const result = value.result;

  if (Array.isArray(result)) {
    return result;
  }

  if (
    result &&
    Array.isArray(result[collectionName])
  ) {
    return result[collectionName];
  }

  return [];
}

function stableKey(row, index) {
  if (!row || typeof row !== "object") {
    return `primitive:${String(row)}:${index}`;
  }

  const fields = [
    "id",
    "campaign_id",
    "campaignId",
    "reply_id",
    "replyId",
    "email",
    "uei",
    "company_id",
    "companyId",
    "opportunity_id",
    "opportunityId",
    "proposal_id",
    "proposalId",
    "name",
    "title"
  ];

  for (const field of fields) {
    if (
      row[field] !== undefined &&
      row[field] !== null &&
      String(row[field]).trim()
    ) {
      return (
        `${field}:` +
        String(row[field])
          .trim()
          .toLowerCase()
      );
    }
  }

  try {
    return `json:${JSON.stringify(row)}`;
  } catch {
    return `row:${index}`;
  }
}

function mergeUnique(current, incoming) {
  const output = [];
  const seen = new Set();

  for (
    const row of [
      ...(current || []),
      ...(incoming || [])
    ]
  ) {
    const key = stableKey(
      row,
      output.length
    );

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(row);
  }

  return output;
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

class LiveBusinessStateService {
  constructor(options = {}) {
    this.root = path.resolve(
      options.root || ROOT
    );

    this.maxFileBytes = toPositiveNumber(
      options.maxFileBytes,
      10 * 1024 * 1024
    );

    this.maxAgeDays = toPositiveNumber(
      options.maxAgeDays,
      30
    );

    this.outputDir = path.resolve(
      options.outputDir ||
      path.join(
        this.root,
        "DATA",
        "runtime"
      )
    );

    this.discoveryCacheTtlMs =
      toPositiveNumber(
        options.discoveryCacheTtlMs ||
        process.env
          .MILES_BUSINESS_DISCOVERY_CACHE_TTL_MS,
        5 * 60 * 1000
      );

    this.parsedCacheMaxEntries =
      toPositiveNumber(
        options.parsedCacheMaxEntries ||
        process.env
          .MILES_BUSINESS_PARSED_CACHE_MAX_ENTRIES,
        250
      );

    this.maxCandidatesPerCollection =
      toPositiveNumber(
        options.maxCandidatesPerCollection ||
        process.env
          .MILES_BUSINESS_MAX_CANDIDATES_PER_COLLECTION,
        20
      );

    this.cacheFile = path.resolve(
      options.cacheFile ||
      process.env
        .MILES_BUSINESS_DISCOVERY_CACHE_FILE ||
      path.join(
        this.outputDir,
        "live_business_discovery_cache.json"
      )
    );

    this.snapshotFile = path.resolve(
      options.snapshotFile ||
      path.join(
        this.outputDir,
        "latest_live_business_state.json"
      )
    );

    this.explicitFiles = {
      campaigns:
        process.env
          .MILES_CAMPAIGNS_STATE_FILE,

      replies:
        process.env
          .MILES_REPLIES_STATE_FILE,

      mailboxes:
        process.env
          .MILES_MAILBOXES_STATE_FILE,

      segments:
        process.env
          .MILES_SEGMENT_INVENTORY_FILE,

      deals:
        process.env
          .MILES_DEALS_FILE ||
        process.env
          .MILES_PIPELINE_STATE_FILE,

      proposals:
        process.env
          .MILES_PROPOSAL_STATE_FILE,

      opportunities:
        process.env
          .MILES_OPPORTUNITY_STATE_FILE,

      contractors:
        process.env
          .MILES_CONTRACTOR_STATE_FILE
    };

    this.discoveryCache = {
      files: [],
      builtAtMs: 0,
      source: "EMPTY"
    };

    this.parsedJsonCache = new Map();

    this.stats = {
      discoveryCalls: 0,
      discoveryCacheHits: 0,
      discoveryCacheMisses: 0,
      fullScans: 0,
      directoriesScanned: 0,
      filesInspected: 0,
      parsedCacheHits: 0,
      parsedCacheMisses: 0,
      parseFailures: 0,
      lastDiscoveryDurationMs: 0,
      lastCollectDurationMs: 0,
      lastEnrichDurationMs: 0,
      lastCacheSource: "EMPTY"
    };

    ensureDir(this.outputDir);

    this.loadPersistentDiscoveryCache();
  }

  getDiscoveryRoots() {
    return [
      path.join(this.root, "DATA"),
      path.join(this.root, "RUNTIME"),
      path.join(this.root, "runtime")
    ]
      .map(dir => path.resolve(dir))
      .filter((dir, index, all) => {
        if (!fs.existsSync(dir)) {
          return false;
        }

        return all.indexOf(dir) === index;
      });
  }

  shouldSkipDirectory(
    directoryName,
    fullPath
  ) {
    void fullPath;

    if (
      directoryName === "node_modules" ||
      directoryName.startsWith("_BACKUP") ||
      directoryName.startsWith("_LEGACY")
    ) {
      return true;
    }

    return false;
  }

  shouldSkipFile(file) {
    const resolved = path.resolve(file);

    return (
      resolved === this.cacheFile ||
      resolved === this.snapshotFile ||
      resolved.endsWith(".tmp")
    );
  }

  isUsableCachedRecord(record, cutoff) {
    if (
      !record ||
      typeof record !== "object" ||
      !record.file
    ) {
      return false;
    }

    if (this.shouldSkipFile(record.file)) {
      return false;
    }

    if (
      !Number.isFinite(
        Number(record.mtimeMs)
      )
    ) {
      return false;
    }

    if (
      !Number.isFinite(
        Number(record.size)
      )
    ) {
      return false;
    }

    if (
      Number(record.size) <= 0 ||
      Number(record.size) >
        this.maxFileBytes
    ) {
      return false;
    }

    if (
      Number(record.mtimeMs) < cutoff
    ) {
      return false;
    }

    return true;
  }

  loadPersistentDiscoveryCache() {
    const persisted =
      safeReadJson(this.cacheFile);

    const cutoff =
      Date.now() -
      this.maxAgeDays * DAY_MS;

    if (
      !persisted ||
      persisted.version !== 1 ||
      persisted.root !== this.root ||
      !Array.isArray(persisted.files)
    ) {
      return false;
    }

    const files = persisted.files
      .filter(record =>
        this.isUsableCachedRecord(
          record,
          cutoff
        )
      )
      .map(record => ({
        file: path.resolve(
          record.file
        ),

        name: String(
          record.name ||
          path.basename(record.file)
        ).toLowerCase(),

        mtimeMs:
          Number(record.mtimeMs),

        size:
          Number(record.size)
      }))
      .sort(
        (a, b) =>
          b.mtimeMs - a.mtimeMs
      );

    this.discoveryCache = {
      files,
      builtAtMs:
        Number(persisted.builtAtMs) || 0,
      source: "PERSISTENT"
    };

    this.stats.lastCacheSource =
      "PERSISTENT";

    return true;
  }

  persistDiscoveryCache() {
    return safeWriteJson(
      this.cacheFile,
      {
        version: 1,
        type:
          "LIVE_BUSINESS_DISCOVERY_CACHE",

        root:
          this.root,

        builtAtMs:
          this.discoveryCache.builtAtMs,

        builtAt:
          new Date(
            this.discoveryCache.builtAtMs
          ).toISOString(),

        maxAgeDays:
          this.maxAgeDays,

        maxFileBytes:
          this.maxFileBytes,

        files:
          this.discoveryCache.files
      }
    );
  }

  isDiscoveryCacheFresh(
    now = Date.now()
  ) {
    if (
      !this.discoveryCache.files.length
    ) {
      return false;
    }

    if (
      !this.discoveryCache.builtAtMs
    ) {
      return false;
    }

    return (
      now -
      this.discoveryCache.builtAtMs <
      this.discoveryCacheTtlMs
    );
  }

  scanJsonFiles() {
    const scanStartedAt = Date.now();

    const roots =
      this.getDiscoveryRoots();

    const files = [];
    const queue = [...roots];

    const cutoff =
      Date.now() -
      this.maxAgeDays * DAY_MS;

    let directoriesScanned = 0;
    let filesInspected = 0;

    while (queue.length) {
      const current = queue.shift();

      let entries;

      try {
        entries = fs.readdirSync(
          current,
          {
            withFileTypes: true
          }
        );

        directoriesScanned += 1;
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = path.join(
          current,
          entry.name
        );

        if (entry.isDirectory()) {
          if (
            this.shouldSkipDirectory(
              entry.name,
              full
            )
          ) {
            continue;
          }

          queue.push(full);
          continue;
        }

        if (
          !entry.isFile() ||
          path
            .extname(entry.name)
            .toLowerCase() !== ".json"
        ) {
          continue;
        }

        filesInspected += 1;

        if (
          this.shouldSkipFile(full)
        ) {
          continue;
        }

        const stat = safeStat(full);

        if (
          !stat ||
          stat.size <= 0 ||
          stat.size >
            this.maxFileBytes
        ) {
          continue;
        }

        if (
          stat.mtimeMs < cutoff
        ) {
          continue;
        }

        files.push({
          file:
            path.resolve(full),

          name:
            entry.name.toLowerCase(),

          mtimeMs:
            stat.mtimeMs,

          size:
            stat.size
        });
      }
    }

    files.sort(
      (a, b) =>
        b.mtimeMs - a.mtimeMs
    );

    this.discoveryCache = {
      files,
      builtAtMs: Date.now(),
      source: "FULL_SCAN"
    };

    this.stats.fullScans += 1;

    this.stats.directoriesScanned =
      directoriesScanned;

    this.stats.filesInspected =
      filesInspected;

    this.stats.lastDiscoveryDurationMs =
      Date.now() - scanStartedAt;

    this.stats.lastCacheSource =
      "FULL_SCAN";

    this.persistDiscoveryCache();

    this.pruneParsedJsonCache(files);

    return files;
  }

  discoverJsonFiles(options = {}) {
    const startedAt = Date.now();

    const forceRefresh =
      options === true ||
      (
        options &&
        typeof options === "object" &&
        options.forceRefresh === true
      );

    this.stats.discoveryCalls += 1;

    if (
      !forceRefresh &&
      this.isDiscoveryCacheFresh()
    ) {
      this.stats.discoveryCacheHits += 1;

      this.stats.lastDiscoveryDurationMs =
        Date.now() - startedAt;

      this.stats.lastCacheSource =
        this.discoveryCache.source ||
        "MEMORY";

      return (
        this.discoveryCache.files.slice()
      );
    }

    this.stats.discoveryCacheMisses += 1;

    return (
      this.scanJsonFiles().slice()
    );
  }

  invalidateDiscoveryCache(
    options = {}
  ) {
    this.discoveryCache.builtAtMs = 0;

    this.discoveryCache.source =
      "INVALIDATED";

    if (
      options.clearFiles === true
    ) {
      this.discoveryCache.files = [];
    }

    if (
      options.clearParsed === true
    ) {
      this.parsedJsonCache.clear();
    }

    if (
      options.deletePersistent === true
    ) {
      try {
        fs.unlinkSync(
          this.cacheFile
        );
      } catch {
        // Cache file may not exist.
      }
    }

    return true;
  }

  pruneParsedJsonCache(
    discoveredFiles = []
  ) {
    const valid = new Set(
      discoveredFiles.map(item =>
        path.resolve(item.file)
      )
    );

    for (
      const file of
      this.parsedJsonCache.keys()
    ) {
      if (!valid.has(file)) {
        this.parsedJsonCache.delete(file);
      }
    }

    while (
      this.parsedJsonCache.size >
      this.parsedCacheMaxEntries
    ) {
      const oldestKey =
        this.parsedJsonCache
          .keys()
          .next()
          .value;

      if (!oldestKey) {
        break;
      }

      this.parsedJsonCache.delete(
        oldestKey
      );
    }
  }

  readJsonCached(candidate) {
    const file = path.resolve(
      candidate.file
    );

    const stat = safeStat(file);

    if (
      !stat ||
      stat.size <= 0 ||
      stat.size >
        this.maxFileBytes
    ) {
      this.parsedJsonCache.delete(file);
      return null;
    }

    const signature =
      `${stat.mtimeMs}:${stat.size}`;

    const cached =
      this.parsedJsonCache.get(file);

    if (
      cached &&
      cached.signature === signature
    ) {
      this.stats.parsedCacheHits += 1;

      this.parsedJsonCache.delete(file);

      this.parsedJsonCache.set(
        file,
        cached
      );

      return cached.value;
    }

    this.stats.parsedCacheMisses += 1;

    const value =
      safeReadJson(file);

    if (value === null) {
      this.stats.parseFailures += 1;

      this.parsedJsonCache.delete(file);

      return null;
    }

    this.parsedJsonCache.set(
      file,
      {
        signature,
        value,
        cachedAtMs: Date.now()
      }
    );

    this.pruneParsedJsonCache(
      this.discoveryCache.files
    );

    return value;
  }

  resolveExplicitCandidate(name) {
    const configured =
      this.explicitFiles[name];

    if (!configured) {
      return null;
    }

    const explicit =
      path.isAbsolute(configured)
        ? path.resolve(configured)
        : path.resolve(
            this.root,
            configured
          );

    const stat = safeStat(explicit);

    if (
      !stat ||
      !stat.isFile()
    ) {
      return null;
    }

    if (
      stat.size <= 0 ||
      stat.size >
        this.maxFileBytes
    ) {
      return null;
    }

    return {
      file:
        explicit,

      name:
        path
          .basename(explicit)
          .toLowerCase(),

      mtimeMs:
        stat.mtimeMs,

      size:
        stat.size,

      explicit:
        true
    };
  }

  collectCollection(
    name,
    discoveredFiles
  ) {
    const rows = [];
    const sources = [];
    const candidates = [];

    const explicitCandidate =
      this.resolveExplicitCandidate(name);

    if (explicitCandidate) {
      candidates.push(
        explicitCandidate
      );
    }

    const hints =
      FILE_HINTS[name] || [name];

    for (
      const candidate of
      discoveredFiles
    ) {
      if (
        hints.some(hint =>
          candidate.name.includes(hint)
        )
      ) {
        candidates.push(candidate);
      }
    }

    const uniqueFiles = [];
    const seen = new Set();

    for (
      const candidate of candidates
    ) {
      const resolved =
        path.resolve(candidate.file);

      if (seen.has(resolved)) {
        continue;
      }

      seen.add(resolved);

      uniqueFiles.push(candidate);
    }

    for (
      const candidate of
      uniqueFiles.slice(
        0,
        this.maxCandidatesPerCollection
      )
    ) {
      const parsed =
        this.readJsonCached(candidate);

      const extracted =
        normalizeRows(
          parsed,
          name
        );

      if (
        process.env
          .MILES_BUSINESS_STATE_VERBOSE ===
        "1"
      ) {
        console.log(
          `[${name}] ` +
          `${candidate.name} -> ` +
          `${extracted.length}`
        );
      }

      if (!extracted.length) {
        continue;
      }

      rows.push(...extracted);

      sources.push({
        file:
          candidate.file,

        rows:
          extracted.length,

        explicit:
          Boolean(
            candidate.explicit
          ),

        modifiedAt:
          new Date(
            candidate.mtimeMs ||
            Date.now()
          ).toISOString()
      });
    }

    return {
      rows:
        mergeUnique([], rows),

      sources
    };
  }

  collect(options = {}) {
    const startedAt = Date.now();

    const discoveredFiles =
      this.discoverJsonFiles(options);

    const business = {};
    const sources = {};
    const missing = [];

    for (const name of COLLECTIONS) {
      const collected =
        this.collectCollection(
          name,
          discoveredFiles
        );

      business[name] =
        collected.rows;

      sources[name] =
        collected.sources;

      if (
        !collected.rows.length
      ) {
        missing.push(name);
      }
    }

    this.stats.lastCollectDurationMs =
      Date.now() - startedAt;

    const snapshot = {
      ok: true,

      type:
        "LIVE_BUSINESS_STATE",

      generatedAt:
        new Date().toISOString(),

      business,

      counts:
        Object.fromEntries(
          COLLECTIONS.map(name => [
            name,
            business[name].length
          ])
        ),

      sources,

      missing,

      sourceFilesInspected:
        discoveredFiles.length,

      cache:
        this.getCacheStats()
    };

    safeWriteJson(
      this.snapshotFile,
      snapshot
    );

    return snapshot;
  }

  enrich(
    executiveState = {},
    options = {}
  ) {
    const startedAt = Date.now();

    const snapshot =
      this.collect(options);

    const currentBusiness =
      executiveState.business &&
      typeof executiveState.business ===
        "object"
        ? executiveState.business
        : {};

    const mergedBusiness = {
      ...currentBusiness
    };

    for (const name of COLLECTIONS) {
      mergedBusiness[name] =
        mergeUnique(
          Array.isArray(
            currentBusiness[name]
          )
            ? currentBusiness[name]
            : [],

          snapshot.business[name]
        );
    }

    this.stats.lastEnrichDurationMs =
      Date.now() - startedAt;

    return {
      executiveState: {
        ...executiveState,

        business:
          mergedBusiness,

        liveBusinessState: {
          generatedAt:
            snapshot.generatedAt,

          counts:
            snapshot.counts,

          sources:
            snapshot.sources,

          missing:
            snapshot.missing,

          sourceFilesInspected:
            snapshot
              .sourceFilesInspected,

          cache:
            this.getCacheStats()
        }
      },

      snapshot
    };
  }

  getCacheStats() {
    return {
      discoveryCacheTtlMs:
        this.discoveryCacheTtlMs,

      discoveryCacheAgeMs:
        this.discoveryCache.builtAtMs
          ? Math.max(
              0,
              Date.now() -
              this.discoveryCache.builtAtMs
            )
          : null,

      discoveryCachedFiles:
        this.discoveryCache.files.length,

      discoveryCacheSource:
        this.discoveryCache.source,

      parsedJsonCacheEntries:
        this.parsedJsonCache.size,

      ...this.stats
    };
  }

  getContext(options = {}) {
    return this.collect(options);
  }

  getState(options = {}) {
    return this.collect(options);
  }

}
module.exports = LiveBusinessStateService;

