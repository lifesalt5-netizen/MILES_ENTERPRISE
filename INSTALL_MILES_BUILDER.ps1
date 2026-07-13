param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"

function Write-File {
  param([string]$Path, [string]$Content)
  $dir = Split-Path $Path -Parent
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Set-Content -Path $Path -Value $Content -Encoding UTF8
  Write-Host "Wrote $Path"
}

if (!(Test-Path $RepoRoot)) {
  throw "RepoRoot not found: $RepoRoot"
}

$builderDir = Join-Path $RepoRoot "BUILDER"
New-Item -ItemType Directory -Force -Path $builderDir | Out-Null

Write-File (Join-Path $builderDir "ProjectScanner.js") @'
const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

const IGNORE_DIRS = new Set([
  ".git", "node_modules", "DATABASE", "TEMP", ".vscode"
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function classify(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".js") return "javascript";
  if (ext === ".ps1") return "powershell";
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".md") return "markdown";
  return "other";
}

function scan() {
  const files = walk(ROOT).map(file => {
    const rel = path.relative(ROOT, file);
    const stat = fs.statSync(file);
    return {
      path: rel.replace(/\\/g, "/"),
      type: classify(file),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  });

  const summary = files.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});

  return {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    summary,
    files
  };
}

function writeReport() {
  const report = scan();
  const outDir = path.join(ROOT, "DATA", "builder");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "project_scan.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  return { outFile, report };
}

module.exports = { scan, writeReport };
'@

Write-File (Join-Path $builderDir "FileEditor.js") @'
const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function safePath(relativePath) {
  const full = path.resolve(ROOT, relativePath);
  if (!full.startsWith(ROOT)) {
    throw new Error(`Unsafe path outside repo: ${relativePath}`);
  }
  return full;
}

function read(relativePath) {
  const full = safePath(relativePath);
  return fs.readFileSync(full, "utf8");
}

function write(relativePath, content) {
  const full = safePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

function exists(relativePath) {
  return fs.existsSync(safePath(relativePath));
}

module.exports = { read, write, exists, safePath };
'@

Write-File (Join-Path $builderDir "GitManager.js") @'
const { execSync } = require("child_process");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function status() {
  try { return run("git status --short"); }
  catch (e) { return e.message; }
}

function currentBranch() {
  try { return run("git branch --show-current"); }
  catch { return "unknown"; }
}

function commit(message) {
  run("git add .");
  const s = status();
  if (!s) return "No changes to commit.";
  return run(`git commit -m "${message.replace(/"/g, "'")}"`);
}

module.exports = { run, status, currentBranch, commit };
'@

Write-File (Join-Path $builderDir "RuntimeController.js") @'
const { execSync } = require("child_process");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function smokeTest() {
  try {
    const out = execSync("node .\\CORE\\Kernel\\StartMiles.js", {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, output: out };
  } catch (e) {
    return {
      ok: false,
      output: (e.stdout || "") + "\n" + (e.stderr || "") + "\n" + e.message
    };
  }
}

module.exports = { smokeTest };
'@

Write-File (Join-Path $builderDir "BuilderService.js") @'
const path = require("path");
const scanner = require("./ProjectScanner");
const git = require("./GitManager");
const runtime = require("./RuntimeController");

class BuilderService {
  scanProject() {
    return scanner.writeReport();
  }

  status() {
    return {
      generatedAt: new Date().toISOString(),
      branch: git.currentBranch(),
      gitStatus: git.status()
    };
  }

  smokeTest() {
    return runtime.smokeTest();
  }

  async execute(task = {}) {
    const action = task.action || task.type || "SCAN_PROJECT";

    if (action === "SCAN_PROJECT") {
      const { outFile, report } = this.scanProject();
      return { ok: true, action, outFile, totalFiles: report.totalFiles, summary: report.summary };
    }

    if (action === "STATUS") {
      return { ok: true, action, status: this.status() };
    }

    if (action === "SMOKE_TEST") {
      return { ok: true, action, result: this.smokeTest() };
    }

    return { ok: false, action, error: `Unsupported builder action: ${action}` };
  }
}

module.exports = new BuilderService();
'@

Write-File (Join-Path $builderDir "index.js") @'
const builder = require("./BuilderService");

async function main() {
  const action = process.argv[2] || "SCAN_PROJECT";
  const result = await builder.execute({ action });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = builder;
'@

# Create connector wrapper so MILES can call Builder through ConnectorManager later.
$connectorDir = Join-Path $RepoRoot "CONNECTORS\MILES"
New-Item -ItemType Directory -Force -Path $connectorDir | Out-Null

Write-File (Join-Path $connectorDir "connector.js") @'
const builder = require("../../BUILDER");

module.exports = {
  name: "MILES",

  async initialize() {
    return { ok: true, service: "MILES Builder" };
  },

  async healthCheck() {
    return {
      status: "OK",
      ok: true,
      service: "MILES Builder",
      message: "Builder connector ready",
      checkedAt: new Date().toISOString()
    };
  },

  async execute(task) {
    const payload = task.payload || task;
    return builder.execute(payload);
  },

  async shutdown() {
    return { ok: true };
  }
};
'@

# Patch MilesKernel to register MILES connector if not already present.
$kernelPath = Join-Path $RepoRoot "CORE\Kernel\MilesKernel.js"
$kernel = Get-Content $kernelPath -Raw

if ($kernel -notmatch "milesConnector") {
  $kernel = $kernel -replace 'const scheduler = require\("\.\./\.\./SERVICES/SchedulerService"\);', 'const scheduler = require("../../SERVICES/SchedulerService");' + "`r`n" + 'const milesConnector = require("../../CONNECTORS/MILES/connector");'
  if ($kernel -notmatch "milesConnector") {
    $kernel = $kernel -replace 'const dashboard = require\("\.\./\.\./SERVICES/DashboardService"\);', 'const dashboard = require("../../SERVICES/DashboardService");' + "`r`n" + 'const milesConnector = require("../../CONNECTORS/MILES/connector");'
  }
  $kernel = $kernel -replace 'registry\.register\("Dashboard", dashboard\);', 'registry.register("Dashboard", dashboard);' + "`r`n" + 'const connectorManager = require("./ConnectorManager");' + "`r`n" + 'connectorManager.register("MILES", milesConnector);'
  Set-Content -Path $kernelPath -Value $kernel -Encoding UTF8
  Write-Host "Patched MilesKernel.js for MILES connector registration"
} else {
  Write-Host "MilesKernel.js already references milesConnector"
}

Write-Host ""
Write-Host "MILES Builder installed."
Write-Host "Test with:"
Write-Host "  node .\BUILDER\index.js SCAN_PROJECT"
Write-Host "  node .\BUILDER\index.js STATUS"
Write-Host "  node .\CORE\Kernel\StartMiles.js"
