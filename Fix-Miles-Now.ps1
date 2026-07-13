param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Step([string]$Text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
}

if (-not (Test-Path $MilesRoot)) {
    throw "MILES root not found: $MilesRoot"
}

Set-Location $MilesRoot
$env:MILES_ROOT = $MilesRoot

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $MilesRoot "runtime\fix_now_backup_$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null

Step "1. STOPPING MILES"
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Step "2. BACKING UP CURRENT FILES"
$targets = @(
    "CONNECTORS\MILES\connector.js",
    "SERVICES\RepositorySearchService.js",
    "DATA\runtime\task_queue.json"
)

foreach ($relative in $targets) {
    $source = Join-Path $MilesRoot $relative
    if (Test-Path $source) {
        $destination = Join-Path $backup $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
        Copy-Item -Force $source $destination
        Write-Host "Backed up: $relative"
    }
}

Step "3. INSTALLING AUTHORITATIVE MILES CONNECTOR"

$connector = @'
"use strict";

/*
  MILES Enterprise
  File: CONNECTORS/MILES/connector.js
  Purpose: Route MILES-native actions to existing internal capability services.
*/

const builder = require("../../SERVICES/capability_builder/AutonomousCapabilityBuilderService");
const repositorySearch = require("../../SERVICES/RepositorySearchService");

const ACTION_HANDLERS = Object.freeze({
  REPOSITORY_SEARCH: repositorySearch,
  CODE_WRITER_CAPABILITY_AUDIT: repositorySearch,
  REPOSITORY_EVIDENCE_REPORT: repositorySearch
});

function resolveAction(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  return String(
    task.action ||
    plan.action ||
    payload.action ||
    task.type ||
    "BUILD_CAPABILITY"
  ).toUpperCase();
}

module.exports = {
  name: "MILES",

  async initialize() {
    return {
      ok: true,
      service: "MILES Internal Capability Connector"
    };
  },

  async healthCheck() {
    return {
      status: "OK",
      ok: true,
      service: "MILES Internal Capability Connector",
      message: "Internal capability routing operational.",
      checkedAt: new Date().toISOString()
    };
  },

  async execute(task = {}) {
    const action = resolveAction(task);
    const handler = ACTION_HANDLERS[action] || builder;

    if (typeof handler.execute === "function") {
      return handler.execute(task);
    }

    if (typeof handler.run === "function") {
      return handler.run(task);
    }

    throw new Error(
      `MILES capability "${action}" exposes neither execute() nor run().`
    );
  },

  async shutdown() {
    return { ok: true };
  }
};
'@

[System.IO.File]::WriteAllText(
    (Join-Path $MilesRoot "CONNECTORS\MILES\connector.js"),
    $connector,
    [System.Text.UTF8Encoding]::new($false)
)

Step "4. INSTALLING FAST REPOSITORY SEARCH SERVICE"

$repository = @'
"use strict";

/*
  MILES Enterprise
  File: SERVICES/RepositorySearchService.js
  Purpose:
    Fast repository-wide source search without traversing generated data,
    dependencies, backups, or archived builds.
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "DATA",
  "BACKUPS",
  "backup",
  "backups",
  "runtime",
  "_REFERENCE",
  "_LEGACY_BUILDS",
  "_REGISTRY_CONVERGENCE_20260710_192356",
  "_REGISTRY_CONVERGENCE_20260710_193412",
  "MILES_Runtime_Registry_Service_V2_v2.0"
]);

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".ps1",
  ".md",
  ".txt",
  ".yml",
  ".yaml"
]);

function now() {
  return new Date().toISOString();
}

function safeRead(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, results);
      continue;
    }

    if (ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }

  return results;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSearchPatterns(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  const source =
    task.query ||
    task.pattern ||
    payload.query ||
    payload.pattern ||
    plan.originalCommand ||
    plan.objective ||
    payload.objective ||
    payload.command ||
    task.command ||
    "";

  if (Array.isArray(source)) {
    return source.map(String).map(v => v.trim()).filter(Boolean).slice(0, 30);
  }

  const text = String(source);
  const quoted = [...text.matchAll(/["'`](.+?)["'`]/g)]
    .map(match => match[1].trim())
    .filter(Boolean);

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^search the repository/i.test(line))
    .filter(line => !/^return:/i.test(line))
    .filter(line => !/^\d+\./.test(line))
    .filter(line => line.length <= 160);

  const candidates = [...quoted, ...lines];
  const unique = [];

  for (const candidate of candidates) {
    if (!unique.includes(candidate)) unique.push(candidate);
  }

  return unique.slice(0, 30);
}

class RepositorySearchService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;
    this.outDir = path.join(this.rootDir, "DATA", "repository_search");
  }

  relative(file) {
    return path.relative(this.rootDir, file).replace(/\\/g, "/");
  }

  searchPatterns(patterns = []) {
    const normalized = patterns
      .map(pattern => pattern instanceof RegExp ? pattern : String(pattern).trim())
      .filter(Boolean);

    const compiled = normalized.map(pattern => ({
      source: String(pattern),
      regex: pattern instanceof RegExp
        ? pattern
        : new RegExp(escapeRegex(pattern), "i")
    }));

    if (!compiled.length) return [];

    const files = walk(this.rootDir);
    const matches = [];

    for (const file of files) {
      const text = safeRead(file);
      if (!text) continue;

      const lines = text.split(/\r?\n/);

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        for (const pattern of compiled) {
          if (pattern.regex.test(line)) {
            matches.push({
              file: this.relative(file),
              line: index + 1,
              pattern: pattern.source,
              text: line.trim()
            });
          }
        }
      }
    }

    return matches;
  }

  findWriteCapabilities() {
    return this.searchPatterns([
      "writeFile",
      "writeFileSync",
      "createWriteStream",
      "CodeWriter",
      "ReplacementWriter",
      "ReplacementGenerator",
      "PatchEngine",
      "PatchGenerator",
      "CodeGenerator",
      "EngineeringWriter",
      "RuntimeWriter",
      "TemplateEngine",
      "PROPOSAL_CREATED",
      "productionModified",
      "approvalRequired",
      "safeMode"
    ]);
  }

  inspectEngineeringService() {
    const file = path.join(
      this.rootDir,
      "SERVICES",
      "EngineeringImprovementService.js"
    );

    const text = safeRead(file);
    const lines = text.split(/\r?\n/);
    const methods = [];

    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(/^\s*(\w+)\s*\([^)]*\)\s*\{/);

      if (match) {
        methods.push({
          method: match[1],
          line: index + 1,
          text: lines[index].trim()
        });
      }
    }

    return {
      file: "SERVICES/EngineeringImprovementService.js",
      exists: fs.existsSync(file),
      methods,
      containsWriteFile: /writeFile|writeFileSync|createWriteStream/.test(text),
      containsProposalCreated: /PROPOSAL_CREATED/.test(text),
      containsProductionModifiedFalse: /productionModified:\s*false/.test(text),
      containsApprovalRequiredTrue: /approvalRequired:\s*true/.test(text),
      containsSafeModeTrue: /safeMode:\s*true/.test(text)
    };
  }

  auditCodeWriterCapability() {
    const matches = this.findWriteCapabilities();
    const engineering = this.inspectEngineeringService();

    const codeWriterNamedMatches = matches.filter(match =>
      /CodeWriter|ReplacementWriter|ReplacementGenerator|PatchEngine|PatchGenerator|CodeGenerator|EngineeringWriter|RuntimeWriter|TemplateEngine/i.test(
        match.text
      )
    );

    const writeMatches = matches.filter(match =>
      /writeFile|writeFileSync|createWriteStream/i.test(match.text)
    );

    return {
      ok: true,
      service: "RepositorySearchService",
      action: "CODE_WRITER_CAPABILITY_AUDIT",
      rootDir: this.rootDir,
      generatedAt: now(),
      productionCodeGenerationEngineExists: codeWriterNamedMatches.length > 0,
      engineeringService: engineering,
      counts: {
        totalMatches: matches.length,
        writeMatches: writeMatches.length,
        codeWriterNamedMatches: codeWriterNamedMatches.length
      },
      writeMatches,
      codeWriterNamedMatches,
      allMatches: matches
    };
  }

  search(task = {}) {
    const patterns = extractSearchPatterns(task);
    const matches = this.searchPatterns(patterns);

    return {
      ok: true,
      service: "RepositorySearchService",
      action: "REPOSITORY_SEARCH",
      query: patterns,
      count: matches.length,
      matches,
      searchedAt: now()
    };
  }

  report(task = {}) {
    const payload = task.payload || {};
    const plan = payload.plan || task.plan || {};

    const action = String(
      task.action ||
      plan.action ||
      payload.action ||
      task.type ||
      "CODE_WRITER_CAPABILITY_AUDIT"
    ).toUpperCase();

    const result =
      action === "REPOSITORY_SEARCH"
        ? this.search(task)
        : this.auditCodeWriterCapability(task);

    fs.mkdirSync(this.outDir, { recursive: true });

    const outFile = path.join(
      this.outDir,
      `${action.toLowerCase()}_${Date.now()}.json`
    );

    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

    return {
      ...result,
      outFile
    };
  }

  run(task = {}) {
    const payload = task.payload || {};
    const plan = payload.plan || task.plan || {};

    const action = String(
      task.action ||
      plan.action ||
      payload.action ||
      task.type ||
      "CODE_WRITER_CAPABILITY_AUDIT"
    ).toUpperCase();

    if (
      action === "REPOSITORY_SEARCH" ||
      action === "CODE_WRITER_CAPABILITY_AUDIT" ||
      action === "REPOSITORY_EVIDENCE_REPORT"
    ) {
      return this.report(task);
    }

    return {
      ok: false,
      service: "RepositorySearchService",
      action,
      error: `Unsupported repository search action: ${action}`,
      supportedActions: [
        "REPOSITORY_SEARCH",
        "CODE_WRITER_CAPABILITY_AUDIT",
        "REPOSITORY_EVIDENCE_REPORT"
      ]
    };
  }

  async execute(task = {}) {
    return this.run(task);
  }
}

module.exports = new RepositorySearchService();
'@

[System.IO.File]::WriteAllText(
    (Join-Path $MilesRoot "SERVICES\RepositorySearchService.js"),
    $repository,
    [System.Text.UTF8Encoding]::new($false)
)

Step "5. CHECKING JAVASCRIPT"

& node --check ".\CONNECTORS\MILES\connector.js"
if ($LASTEXITCODE -ne 0) { throw "MILES connector syntax check failed." }

& node --check ".\SERVICES\RepositorySearchService.js"
if ($LASTEXITCODE -ne 0) { throw "RepositorySearchService syntax check failed." }

Write-Host "JavaScript checks passed." -ForegroundColor Green

Step "6. RECOVERING AND EXECUTING THE STALE TASK THROUGH MILES"

$runnerPath = Join-Path $MilesRoot "runtime\FixMilesNowRunner.js"
$runner = @'
"use strict";

require("dotenv").config();

const taskQueue = require("../CORE/TaskQueue");
const supervisor = require("../CORE/Supervisor");
const executionService = require("../SERVICES/ExecutionService");

const STALE_MS = 15 * 60 * 1000;

async function main() {
  await supervisor.registerConnectors();

  console.log("[FIX] Connectors:", require("../CORE/ConnectorManager").list());

  const running = taskQueue.list("RUNNING");
  const now = Date.now();
  let recovered = 0;

  for (const task of running) {
    const timestamp = new Date(task.updatedAt || task.createdAt || 0).getTime();
    const stale = !Number.isFinite(timestamp) || now - timestamp >= STALE_MS;

    if (!stale) continue;

    taskQueue.update(task.id, {
      status: "QUEUED",
      result: null,
      recovery: {
        reason: "STALE_RUNNING_TASK",
        previousStatus: "RUNNING",
        recoveredAt: new Date().toISOString(),
        recoveredBy: "FixMilesNowRunner"
      }
    });

    recovered++;
    console.log("[FIX] Requeued:", task.id);
  }

  console.log("[FIX] Recovered stale tasks:", recovered);

  let passes = 0;

  while (taskQueue.list("QUEUED").length && passes < 10) {
    passes++;
    console.log(`[FIX] Execution pass ${passes}`);
    const result = await executionService.runNext();
    console.log("[FIX] Result:", JSON.stringify(result, null, 2));
  }

  const status = taskQueue.getStatus();
  console.log("[FIX] Final queue:", JSON.stringify(status, null, 2));

  const remainingRunning = taskQueue.list("RUNNING");
  if (remainingRunning.length) {
    console.error("[FIX] FAIL: RUNNING tasks remain.");
    console.error(JSON.stringify(remainingRunning, null, 2));
    process.exitCode = 2;
    return;
  }

  console.log("[FIX] PASS: stale task recovery and execution completed.");
}

main().catch(error => {
  console.error("[FIX] FATAL:", error);
  process.exitCode = 1;
});
'@

New-Item -ItemType Directory -Force -Path (Split-Path $runnerPath -Parent) | Out-Null
[System.IO.File]::WriteAllText(
    $runnerPath,
    $runner,
    [System.Text.UTF8Encoding]::new($false)
)

& node $runnerPath
if ($LASTEXITCODE -ne 0) {
    throw "MILES direct recovery/execution test failed. Backup is at: $backup"
}

Step "7. STARTING MILES PRODUCTION"

$stdout = Join-Path $MilesRoot "runtime\FixMilesNow_$stamp.stdout.log"
$stderr = Join-Path $MilesRoot "runtime\FixMilesNow_$stamp.stderr.log"

$process = Start-Process `
    -FilePath "node" `
    -ArgumentList @("StartMilesProduction.js") `
    -WorkingDirectory $MilesRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

Start-Sleep -Seconds 15

if ($process.HasExited) {
    Write-Host "MILES exited during startup." -ForegroundColor Red
    if (Test-Path $stdout) { Get-Content $stdout -Tail 100 }
    if (Test-Path $stderr) { Get-Content $stderr -Tail 100 }
    throw "MILES production did not remain running."
}

Step "MILES IS RUNNING"

Write-Host "Production bootstrap PID: $($process.Id)" -ForegroundColor Green
Write-Host "Backup: $backup"
Write-Host "Output log: $stdout"
Write-Host "Error log: $stderr"
Write-Host ""
Write-Host "Current task queue:" -ForegroundColor Cyan

& node -e "const q=require('./CORE/TaskQueue'); console.log(JSON.stringify(q.getStatus(),null,2));"

Write-Host ""
Write-Host "MILES has been repaired, the stale task was recovered through the official TaskQueue API, and production was restarted." -ForegroundColor Green
