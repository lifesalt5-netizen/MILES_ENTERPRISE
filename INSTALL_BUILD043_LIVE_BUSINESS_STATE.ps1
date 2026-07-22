param(
  [string]$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

Write-Host "[BUILD043] Live Business State Layer installer starting..."

$LoopFile = Join-Path $Root "SERVICES\AutonomousCOOLoopService.js"
$ServiceFile = Join-Path $Root "SERVICES\LiveBusinessStateService.js"
$TestFile = Join-Path $Root "TESTS\Test_Build043_LiveBusinessState.js"

if (!(Test-Path $LoopFile)) {
  throw "Authoritative loop not found: $LoopFile"
}

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $Root "_BACKUPS\BUILD043_$Stamp"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $TestFile -Parent) | Out-Null

Copy-Item $LoopFile (Join-Path $BackupDir "AutonomousCOOLoopService.js") -Force
if (Test-Path $ServiceFile) {
  Copy-Item $ServiceFile (Join-Path $BackupDir "LiveBusinessStateService.js") -Force
}

$ServiceSource = @'
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
  campaigns: ["campaign", "instantly"],
  replies: ["reply", "inbox", "lead_response"],
  mailboxes: ["mailbox", "account_health", "sending_account"],
  segments: ["segment_inventory", "segments", "outreach_segment"],
  deals: ["pipeline", "deals", "crm"],
  proposals: ["proposal", "pursuit", "submission"],
  opportunities: ["opportunity", "bid_board", "orion"],
  contractors: ["contractor", "vendor", "company"]
};

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

function safeJson(file) {
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeRows(value, collectionName) {
  if (Array.isArray(value)) return value;

  if (!value || typeof value !== "object") return [];

  const direct = value[collectionName];
  if (Array.isArray(direct)) return direct;

  const business = value.business;
  if (business && Array.isArray(business[collectionName])) {
    return business[collectionName];
  }

  const data = value.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[collectionName])) return data[collectionName];

  const result = value.result;
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result[collectionName])) return result[collectionName];

  return [];
}

function stableKey(row, index) {
  if (!row || typeof row !== "object") return `primitive:${String(row)}:${index}`;

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
    if (row[field] !== undefined && row[field] !== null && String(row[field]).trim()) {
      return `${field}:${String(row[field]).trim().toLowerCase()}`;
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

  for (const row of [...(current || []), ...(incoming || [])]) {
    const key = stableKey(row, output.length);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }

  return output;
}

class LiveBusinessStateService {
  constructor(options = {}) {
    this.root = options.root || ROOT;
    this.maxFileBytes = Number(options.maxFileBytes || 10 * 1024 * 1024);
    this.maxAgeDays = Number(options.maxAgeDays || 30);
    this.outputDir =
      options.outputDir ||
      path.join(this.root, "DATA", "runtime");

    this.explicitFiles = {
      campaigns: process.env.MILES_CAMPAIGNS_STATE_FILE,
      replies: process.env.MILES_REPLIES_STATE_FILE,
      mailboxes: process.env.MILES_MAILBOXES_STATE_FILE,
      segments: process.env.MILES_SEGMENT_INVENTORY_FILE,
      deals: process.env.MILES_PIPELINE_STATE_FILE,
      proposals: process.env.MILES_PROPOSAL_STATE_FILE,
      opportunities: process.env.MILES_OPPORTUNITY_STATE_FILE,
      contractors: process.env.MILES_CONTRACTOR_STATE_FILE
    };
  }

  discoverJsonFiles() {
    const roots = [
      path.join(this.root, "DATA"),
      path.join(this.root, "RUNTIME"),
      path.join(this.root, "runtime")
    ].filter(dir => fs.existsSync(dir));

    const files = [];
    const queue = [...roots];
    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000;

    while (queue.length) {
      const current = queue.shift();
      let entries = [];

      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = path.join(current, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name === "node_modules" ||
            entry.name.startsWith("_BACKUP") ||
            entry.name.startsWith("_LEGACY")
          ) {
            continue;
          }
          queue.push(full);
          continue;
        }

        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
          continue;
        }

        const stat = safeStat(full);
        if (!stat || stat.size <= 0 || stat.size > this.maxFileBytes) continue;
        if (stat.mtimeMs < cutoff) continue;

        files.push({
          file: full,
          name: entry.name.toLowerCase(),
          mtimeMs: stat.mtimeMs,
          size: stat.size
        });
      }
    }

    return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  collectCollection(name, discoveredFiles) {
    const rows = [];
    const sources = [];

    const explicit = this.explicitFiles[name];
    const candidates = [];

    if (explicit && fs.existsSync(explicit)) {
      candidates.push({
        file: explicit,
        name: path.basename(explicit).toLowerCase(),
        mtimeMs: safeStat(explicit)?.mtimeMs || Date.now(),
        explicit: true
      });
    }

    const hints = FILE_HINTS[name] || [name];

    for (const candidate of discoveredFiles) {
      if (hints.some(hint => candidate.name.includes(hint))) {
        candidates.push(candidate);
      }
    }

    const uniqueFiles = [];
    const seen = new Set();

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate.file);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      uniqueFiles.push(candidate);
    }

    for (const candidate of uniqueFiles.slice(0, 20)) {
      const parsed = safeJson(candidate.file);
      const extracted = normalizeRows(parsed, name);

      if (!extracted.length) continue;

      rows.push(...extracted);
      sources.push({
        file: candidate.file,
        rows: extracted.length,
        explicit: Boolean(candidate.explicit),
        modifiedAt: new Date(candidate.mtimeMs || Date.now()).toISOString()
      });
    }

    return {
      rows: mergeUnique([], rows),
      sources
    };
  }

  collect() {
    const discoveredFiles = this.discoverJsonFiles();
    const business = {};
    const sources = {};
    const missing = [];

    for (const name of COLLECTIONS) {
      const collected = this.collectCollection(name, discoveredFiles);
      business[name] = collected.rows;
      sources[name] = collected.sources;

      if (!collected.rows.length) {
        missing.push(name);
      }
    }

    const snapshot = {
      ok: true,
      type: "LIVE_BUSINESS_STATE",
      generatedAt: new Date().toISOString(),
      business,
      counts: Object.fromEntries(
        COLLECTIONS.map(name => [name, business[name].length])
      ),
      sources,
      missing,
      sourceFilesInspected: discoveredFiles.length
    };

    ensureDir(this.outputDir);
    fs.writeFileSync(
      path.join(this.outputDir, "latest_live_business_state.json"),
      JSON.stringify(snapshot, null, 2)
    );

    return snapshot;
  }

  enrich(executiveState = {}) {
    const snapshot = this.collect();
    const currentBusiness =
      executiveState.business && typeof executiveState.business === "object"
        ? executiveState.business
        : {};

    const mergedBusiness = { ...currentBusiness };

    for (const name of COLLECTIONS) {
      mergedBusiness[name] = mergeUnique(
        Array.isArray(currentBusiness[name]) ? currentBusiness[name] : [],
        snapshot.business[name]
      );
    }

    return {
      executiveState: {
        ...executiveState,
        business: mergedBusiness,
        liveBusinessState: {
          generatedAt: snapshot.generatedAt,
          counts: snapshot.counts,
          sources: snapshot.sources,
          missing: snapshot.missing,
          sourceFilesInspected: snapshot.sourceFilesInspected
        }
      },
      snapshot
    };
  }
}

module.exports = LiveBusinessStateService;
'@

Set-Content -Path $ServiceFile -Value $ServiceSource -Encoding UTF8

$Source = Get-Content $LoopFile -Raw

if ($Source -notmatch 'LiveBusinessStateService') {
  $Needle = 'const BusinessOperationsBridgeService = require("./BusinessOperationsBridgeService");'
  $Replacement = $Needle + [Environment]::NewLine + 'const LiveBusinessStateService = require("./LiveBusinessStateService");'
  if (!$Source.Contains($Needle)) {
    throw "Could not locate require insertion point."
  }
  $Source = $Source.Replace($Needle, $Replacement)
}

if ($Source -notmatch 'this\.liveBusinessState') {
  $Needle = '    this.executionService = options.executionService || null;'
  $Replacement = $Needle + [Environment]::NewLine + '    this.liveBusinessState = options.liveBusinessState || new LiveBusinessStateService();'
  if (!$Source.Contains($Needle)) {
    throw "Could not locate constructor insertion point."
  }
  $Source = $Source.Replace($Needle, $Replacement)
}

$FirstStatePattern = '    const executiveState = await this\.intelligence\.getExecutiveState\(\);'
if ($Source -notmatch 'liveBusinessEnrichment = this\.liveBusinessState\.enrich') {
  $FirstReplacement = @'
    let executiveState = await this.intelligence.getExecutiveState();
    const liveBusinessEnrichment = this.liveBusinessState.enrich(executiveState);
    executiveState = liveBusinessEnrichment.executiveState;
'@
  $Source = [regex]::Replace(
    $Source,
    $FirstStatePattern,
    $FirstReplacement.TrimEnd(),
    1
  )
}

$RefreshedPattern = '    const refreshedExecutiveState = await this\.intelligence\.getExecutiveState\(\);'
if ($Source -notmatch 'refreshedLiveBusinessEnrichment') {
  $RefreshedReplacement = @'
    let refreshedExecutiveState = await this.intelligence.getExecutiveState();
    const refreshedLiveBusinessEnrichment = this.liveBusinessState.enrich(refreshedExecutiveState);
    refreshedExecutiveState = refreshedLiveBusinessEnrichment.executiveState;
'@
  $Source = [regex]::Replace(
    $Source,
    $RefreshedPattern,
    $RefreshedReplacement.TrimEnd(),
    1
  )
}

if ($Source -notmatch 'liveBusinessState:\s*refreshedLiveBusinessEnrichment\.snapshot') {
  $Needle = '      businessOperationsBridge: bridgeResults,'
  $Replacement = $Needle + [Environment]::NewLine + '      liveBusinessState: refreshedLiveBusinessEnrichment.snapshot,'
  if (!$Source.Contains($Needle)) {
    throw "Could not locate cycle result insertion point."
  }
  $Source = $Source.Replace($Needle, $Replacement)
}

Set-Content -Path $LoopFile -Value $Source -Encoding UTF8

$TestSource = @'
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const LiveBusinessStateService = require("../SERVICES/LiveBusinessStateService");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-build043-"));
const dataDir = path.join(root, "DATA", "instantly");
fs.mkdirSync(dataDir, { recursive: true });

fs.writeFileSync(
  path.join(dataDir, "latest_campaigns.json"),
  JSON.stringify({
    campaigns: [
      { id: "C-1", status: "active" },
      { id: "C-2", status: "paused" }
    ]
  })
);

fs.writeFileSync(
  path.join(dataDir, "latest_replies.json"),
  JSON.stringify({
    replies: [
      { id: "R-1", classification: "Positive" }
    ]
  })
);

fs.writeFileSync(
  path.join(dataDir, "segment_inventory.json"),
  JSON.stringify({
    segments: [
      { id: "S-1", name: "GSA No Sales", verifiedEmailCount: 250 }
    ]
  })
);

const service = new LiveBusinessStateService({
  root,
  maxAgeDays: 3650
});

const result = service.enrich({
  business: {
    campaigns: [
      { id: "C-1", status: "active" }
    ],
    deals: [
      { id: "D-1", stage: "warm" }
    ]
  }
});

assert.strictEqual(result.snapshot.counts.campaigns, 2);
assert.strictEqual(result.snapshot.counts.replies, 1);
assert.strictEqual(result.snapshot.counts.segments, 1);
assert.strictEqual(result.executiveState.business.campaigns.length, 2);
assert.strictEqual(result.executiveState.business.deals.length, 1);
assert.ok(
  fs.existsSync(
    path.join(root, "DATA", "runtime", "latest_live_business_state.json")
  )
);

console.log("BUILD043 Live Business State test PASSED");
console.log(JSON.stringify(result.snapshot, null, 2));
'@

Set-Content -Path $TestFile -Value $TestSource -Encoding UTF8

Write-Host "[BUILD043] Running PowerShell-independent JavaScript syntax checks..."

& node --check $ServiceFile
if ($LASTEXITCODE -ne 0) {
  throw "LiveBusinessStateService syntax validation failed. Backup retained: $BackupDir"
}

& node --check $LoopFile
if ($LASTEXITCODE -ne 0) {
  Copy-Item (Join-Path $BackupDir "AutonomousCOOLoopService.js") $LoopFile -Force
  throw "AutonomousCOOLoopService syntax validation failed. Loop restored."
}

& node --check $TestFile
if ($LASTEXITCODE -ne 0) {
  throw "BUILD043 test syntax validation failed."
}

Push-Location $Root
try {
  & node $TestFile
  if ($LASTEXITCODE -ne 0) {
    throw "BUILD043 Live Business State test failed."
  }
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "BUILD043 INSTALLED AND VALIDATED"
Write-Host "Backup: $BackupDir"
Write-Host ""
Write-Host "Next production validation commands:"
Write-Host "  taskkill /F /IM node.exe"
Write-Host "  node StartMilesProduction.js"
Write-Host ""
Write-Host "After startup, inspect:"
Write-Host "  DATA\runtime\latest_live_business_state.json"
