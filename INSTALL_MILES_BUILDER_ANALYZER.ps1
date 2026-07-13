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

if (!(Test-Path $RepoRoot)) { throw "RepoRoot not found: $RepoRoot" }

$builderDir = Join-Path $RepoRoot "BUILDER"
if (!(Test-Path $builderDir)) { throw "BUILDER folder not found. Run INSTALL_MILES_BUILDER.ps1 first." }

Write-File (Join-Path $builderDir "ProjectAnalyzer.js") @'
const fs = require("fs");
const path = require("path");
const scanner = require("./ProjectScanner");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function groupByBasename(files) {
  const groups = new Map();
  for (const f of files) {
    const base = path.basename(f.path).toLowerCase();
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(f.path);
  }
  return Array.from(groups.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

function analyze() {
  const report = scanner.scan();
  const files = report.files;
  const jsFiles = files.filter(f => f.type === "javascript");

  const requiredServices = [
    "SERVICES/ExecutionService.js",
    "SERVICES/SchedulerService.js",
    "SERVICES/DashboardService.js",
    "SERVICES/TaskManager.js",
    "SERVICES/MemoryService.js"
  ];

  const requiredKernel = [
    "CORE/Kernel/MilesKernel.js",
    "CORE/Kernel/ServiceRegistry.js",
    "CORE/Kernel/ConnectorManager.js",
    "CORE/Kernel/EventBus.js",
    "CORE/Kernel/StartMiles.js"
  ];

  const recommendedConnectors = [
    "CONNECTORS/MILES/connector.js",
    "CONNECTORS/ORION/connector.js",
    "CONNECTORS/INSTANTLY/connector.js",
    "CONNECTORS/GOOGLE/connector.js",
    "CONNECTORS/WEBSITE/connector.js",
    "CONNECTORS/NAMECHEAP/connector.js"
  ];

  const emptyFiles = files.filter(f => f.bytes === 0).map(f => f.path);
  const duplicates = groupByBasename(jsFiles);

  const missingServices = requiredServices.filter(f => !exists(f));
  const missingKernel = requiredKernel.filter(f => !exists(f));
  const missingConnectors = recommendedConnectors.filter(f => !exists(f));

  const warnings = [];
  if (duplicates.some(d => d.name === "logger.js")) {
    warnings.push("Multiple logger.js/Logger.js-style files may create case-sensitivity problems.");
  }
  if (exists("node_modules")) {
    warnings.push("node_modules exists locally. Ensure it is not tracked by Git.");
  }
  if (exists(".env")) {
    warnings.push(".env exists locally. Ensure secrets are rotated if exposed and never committed.");
  }
  if (emptyFiles.length) {
    warnings.push(`${emptyFiles.length} empty files found.`);
  }

  const recommendations = [];
  if (missingConnectors.length) recommendations.push("Build missing standard connector wrappers so ConnectorManager can register real business systems.");
  if (missingServices.length) recommendations.push("Complete missing services before expanding business automation.");
  recommendations.push("Commit the stable runtime state to develop after successful smoke test.");

  return {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    totals: report.summary,
    totalFiles: report.totalFiles,
    requiredServices,
    missingServices,
    requiredKernel,
    missingKernel,
    recommendedConnectors,
    missingConnectors,
    emptyFiles,
    duplicates,
    warnings,
    recommendations
  };
}

function writeReport() {
  const result = analyze();
  const outDir = path.join(ROOT, "DATA", "builder");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "project_analysis.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  return { outFile, result };
}

module.exports = { analyze, writeReport };
'@

# Patch BuilderService to support ANALYZE_PROJECT if not already supported.
$servicePath = Join-Path $builderDir "BuilderService.js"
$service = Get-Content $servicePath -Raw

if ($service -notmatch 'ProjectAnalyzer') {
  $service = $service -replace 'const scanner = require\("\.\/ProjectScanner"\);', 'const scanner = require("./ProjectScanner");' + "`r`n" + 'const analyzer = require("./ProjectAnalyzer");'
}

if ($service -notmatch 'ANALYZE_PROJECT') {
  $insert = @'

    if (action === "ANALYZE_PROJECT") {
      const { outFile, result } = analyzer.writeReport();
      return {
        ok: true,
        action,
        outFile,
        totalFiles: result.totalFiles,
        missingServices: result.missingServices,
        missingConnectors: result.missingConnectors,
        emptyFiles: result.emptyFiles,
        duplicateCount: result.duplicates.length,
        warnings: result.warnings,
        recommendations: result.recommendations
      };
    }
'@
  $service = $service -replace '    if \(action === "SMOKE_TEST"\) \{\r?\n      return \{ ok: true, action, result: this\.smokeTest\(\) \};\r?\n    \}', '$&' + $insert
}

Set-Content -Path $servicePath -Value $service -Encoding UTF8
Write-Host "Patched BUILDER\BuilderService.js with ANALYZE_PROJECT"

Write-Host ""
Write-Host "MILES Builder Analyzer installed. Test with:"
Write-Host "  node .\BUILDER\index.js ANALYZE_PROJECT"
