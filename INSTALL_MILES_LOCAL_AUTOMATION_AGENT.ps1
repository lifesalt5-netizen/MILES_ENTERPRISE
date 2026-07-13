param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"

function Write-Status($msg) {
    Write-Host "[MILES AUTOMATION] $msg" -ForegroundColor Cyan
}

if (!(Test-Path $RepoRoot)) {
    throw "RepoRoot not found: $RepoRoot"
}

$automationDir = Join-Path $RepoRoot "AUTOMATION"
$servicesDir = Join-Path $automationDir "services"
$scriptsDir = Join-Path $RepoRoot "scripts"
$dataDir = Join-Path $RepoRoot "DATA\automation"
$reportsDir = Join-Path $RepoRoot "DATA\automation\reports"

New-Item -ItemType Directory -Force $automationDir | Out-Null
New-Item -ItemType Directory -Force $servicesDir | Out-Null
New-Item -ItemType Directory -Force $scriptsDir | Out-Null
New-Item -ItemType Directory -Force $dataDir | Out-Null
New-Item -ItemType Directory -Force $reportsDir | Out-Null

$agentJs = @'
const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const LocalAutomationAgent = require("./services/LocalAutomationAgent");

async function main() {
  const action = (process.argv[2] || "STATUS").toUpperCase();
  const arg1 = process.argv[3];
  const arg2 = process.argv[4];

  const agent = new LocalAutomationAgent(ROOT);
  const result = await agent.execute({ action, arg1, arg2 });

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
'@

$localAgentJs = @'
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizePath(root, target) {
  const resolved = path.resolve(root, target || "");
  if (!resolved.toLowerCase().startsWith(path.resolve(root).toLowerCase())) {
    throw new Error(`Blocked path outside repo: ${target}`);
  }
  return resolved;
}

function run(cmd, cwd, timeoutMs = 120000) {
  return child_process.execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    windowsHide: true
  });
}

class LocalAutomationAgent {
  constructor(root) {
    this.root = root;
    this.dataDir = path.join(root, "DATA", "automation");
    this.reportDir = path.join(this.dataDir, "reports");
    this.queueFile = path.join(this.dataDir, "automation_queue.json");
    this.logFile = path.join(root, "MILES_AUTOMATION_LOG.jsonl");

    ensureDir(this.dataDir);
    ensureDir(this.reportDir);

    if (!fs.existsSync(this.queueFile)) {
      fs.writeFileSync(this.queueFile, JSON.stringify([], null, 2));
    }
  }

  log(entry) {
    fs.appendFileSync(this.logFile, JSON.stringify({ ts: now(), ...entry }) + "\n");
  }

  status() {
    let gitStatus = "";
    let branch = "";
    try { gitStatus = run("git status --short", this.root).trim(); } catch (e) { gitStatus = `ERROR: ${e.message}`; }
    try { branch = run("git branch --show-current", this.root).trim(); } catch (e) { branch = "unknown"; }

    const queue = JSON.parse(fs.readFileSync(this.queueFile, "utf8"));

    return {
      ok: true,
      action: "STATUS",
      root: this.root,
      branch,
      queued: queue.filter(t => t.status === "QUEUED").length,
      running: queue.filter(t => t.status === "RUNNING").length,
      completed: queue.filter(t => t.status === "COMPLETED").length,
      failed: queue.filter(t => t.status === "FAILED").length,
      gitStatus
    };
  }

  writeFile(relPath, content) {
    const file = normalizePath(this.root, relPath);
    ensureDir(path.dirname(file));

    if (fs.existsSync(file)) {
      const backup = `${file}.bak.${Date.now()}`;
      fs.copyFileSync(file, backup);
    }

    fs.writeFileSync(file, content, "utf8");
    this.log({ action: "WRITE_FILE", relPath, result: "OK" });
    return { ok: true, action: "WRITE_FILE", file: relPath };
  }

  readFile(relPath) {
    const file = normalizePath(this.root, relPath);
    if (!fs.existsSync(file)) return { ok: false, error: `Missing file: ${relPath}` };
    return { ok: true, action: "READ_FILE", file: relPath, content: fs.readFileSync(file, "utf8") };
  }

  checkJs(relPath) {
    const file = normalizePath(this.root, relPath);
    const output = run(`node --check "${file}"`, this.root);
    return { ok: true, action: "CHECK_JS", file: relPath, output: output.trim() || "Syntax OK" };
  }

  gitStatus() {
    return {
      ok: true,
      action: "GIT_STATUS",
      branch: run("git branch --show-current", this.root).trim(),
      status: run("git status --short", this.root)
    };
  }

  smokeTest() {
    const results = [];

    const checks = [
      "BUILDER/index.js",
      "BUILDER/BuilderService.js",
      "BUILDER/ConnectorBuilder.js",
      "SERVICES/ExecutionService.js",
      "SERVICES/SchedulerService.js",
      "SERVICES/DashboardService.js",
      "CORE/Kernel/StartMiles.js"
    ];

    for (const rel of checks) {
      const file = path.join(this.root, rel);
      if (!fs.existsSync(file)) {
        results.push({ file: rel, ok: false, error: "missing" });
        continue;
      }
      try {
        run(`node --check "${file}"`, this.root);
        results.push({ file: rel, ok: true });
      } catch (e) {
        results.push({ file: rel, ok: false, error: e.message });
      }
    }

    return {
      ok: results.every(r => r.ok),
      action: "SMOKE_TEST",
      results
    };
  }

  fixBuilderService() {
    const content = `const scanner = require("./ProjectScanner");
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
    const action = (task.action || task.type || "SCAN_PROJECT").toUpperCase();

    const commands = {
      SCAN_PROJECT: () => {
        const { outFile, report } = this.scanProject();
        return {
          ok: true,
          action,
          outFile,
          totalFiles: report.totalFiles,
          summary: report.summary
        };
      },

      STATUS: () => ({
        ok: true,
        action,
        status: this.status()
      }),

      SMOKE_TEST: () => ({
        ok: true,
        action,
        result: this.smokeTest()
      }),

      ANALYZE_PROJECT: () => {
        const { outFile, result } = require("./ProjectAnalyzer").writeReport();
        return {
          ok: true,
          action,
          outFile,
          analysis: result
        };
      },

      BUILD_PLAN: () => require("./BuildPlanner").run(),

      TEST_RUNTIME: () => {
        const controller = require("./RuntimeController");
        if (typeof controller.fullTest === "function") return controller.fullTest();
        return controller.smokeTest();
      },

      BUILD_CONNECTOR: () => require("./ConnectorBuilder").run(task)
    };

    if (!commands[action]) {
      return {
        ok: false,
        action,
        error: \`Unsupported builder action: \${action}\`
      };
    }

    return await commands[action]();
  }
}

module.exports = new BuilderService();
`;

    return this.writeFile("BUILDER/BuilderService.js", content);
  }

  buildConnector(name) {
    const connectorName = name || "ORION";
    const out = run(`node .\\BUILDER\\index.js BUILD_CONNECTOR ${connectorName}`, this.root);
    return {
      ok: true,
      action: "BUILD_CONNECTOR",
      connector: connectorName,
      output: JSON.parse(out)
    };
  }

  runQueuedOnce() {
    const queue = JSON.parse(fs.readFileSync(this.queueFile, "utf8"));
    const task = queue.find(t => t.status === "QUEUED");
    if (!task) return { ok: true, action: "RUN_QUEUED_ONCE", message: "No queued automation tasks" };

    task.status = "RUNNING";
    task.startedAt = now();
    fs.writeFileSync(this.queueFile, JSON.stringify(queue, null, 2));

    try {
      const result = this.execute(task);
      task.status = "COMPLETED";
      task.completedAt = now();
      task.result = result;
      fs.writeFileSync(this.queueFile, JSON.stringify(queue, null, 2));
      return { ok: true, action: "RUN_QUEUED_ONCE", task, result };
    } catch (e) {
      task.status = "FAILED";
      task.failedAt = now();
      task.error = e.message;
      fs.writeFileSync(this.queueFile, JSON.stringify(queue, null, 2));
      return { ok: false, action: "RUN_QUEUED_ONCE", task, error: e.message };
    }
  }

  enqueue(action, payload = {}) {
    const queue = JSON.parse(fs.readFileSync(this.queueFile, "utf8"));
    const task = {
      id: `AUTO-${Date.now()}`,
      action,
      payload,
      status: "QUEUED",
      createdAt: now()
    };
    queue.push(task);
    fs.writeFileSync(this.queueFile, JSON.stringify(queue, null, 2));
    return { ok: true, action: "ENQUEUE", task };
  }

  async execute(task = {}) {
    const action = (task.action || "STATUS").toUpperCase();
    const arg1 = task.arg1 || task.payload?.arg1;
    const arg2 = task.arg2 || task.payload?.arg2;

    try {
      let result;

      if (action === "STATUS") result = this.status();
      else if (action === "FIX_BUILDER_SERVICE") result = this.fixBuilderService();
      else if (action === "BUILD_CONNECTOR") result = this.buildConnector(arg1 || task.payload?.connector);
      else if (action === "CHECK_JS") result = this.checkJs(arg1);
      else if (action === "READ_FILE") result = this.readFile(arg1);
      else if (action === "WRITE_FILE") result = this.writeFile(arg1, arg2 || task.payload?.content || "");
      else if (action === "GIT_STATUS") result = this.gitStatus();
      else if (action === "SMOKE_TEST") result = this.smokeTest();
      else if (action === "RUN_QUEUED_ONCE") result = this.runQueuedOnce();
      else if (action === "ENQUEUE") result = this.enqueue(arg1, task.payload || {});
      else result = { ok: false, action, error: `Unsupported automation action: ${action}` };

      this.log({ action, ok: result.ok, result });
      return result;
    } catch (e) {
      const result = { ok: false, action, error: e.message };
      this.log({ action, ok: false, error: e.message });
      return result;
    }
  }
}

module.exports = LocalAutomationAgent;
'@

$startScript = @'
param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

Set-Location $RepoRoot
$env:MILES_ROOT = $RepoRoot

Write-Host "MILES Automation Agent" -ForegroundColor Green
Write-Host "Repo: $RepoRoot"
Write-Host ""

node .\AUTOMATION\Agent.js STATUS
'@

$readme = @'
# MILES Automation Agent

This is the local execution layer for MILES COO.

## Purpose

The Automation Agent removes Kevin from manual patching by allowing local MILES to:

- write files inside the repository
- create backups before edits
- run Node syntax checks
- run smoke tests
- check Git status
- invoke Builder actions
- produce logs and reports

## Commands

```powershell
node .\AUTOMATION\Agent.js STATUS
node .\AUTOMATION\Agent.js FIX_BUILDER_SERVICE
node .\AUTOMATION\Agent.js SMOKE_TEST
node .\AUTOMATION\Agent.js BUILD_CONNECTOR ORION
node .\AUTOMATION\Agent.js GIT_STATUS
```

## Governance

The agent is repo-bound. It blocks file writes outside MILES_OS.
'@

Set-Content -Path (Join-Path $automationDir "Agent.js") -Value $agentJs -Encoding UTF8
Set-Content -Path (Join-Path $servicesDir "LocalAutomationAgent.js") -Value $localAgentJs -Encoding UTF8
Set-Content -Path (Join-Path $scriptsDir "START_MILES_AUTOMATION.ps1") -Value $startScript -Encoding UTF8
Set-Content -Path (Join-Path $automationDir "README.md") -Value $readme -Encoding UTF8

Write-Status "Installed AUTOMATION agent."
Write-Status "Created: AUTOMATION\Agent.js"
Write-Status "Created: AUTOMATION\services\LocalAutomationAgent.js"
Write-Status "Created: scripts\START_MILES_AUTOMATION.ps1"
Write-Status ""
Write-Status "Next commands:"
Write-Host "node .\AUTOMATION\Agent.js STATUS"
Write-Host "node .\AUTOMATION\Agent.js FIX_BUILDER_SERVICE"
Write-Host "node .\AUTOMATION\Agent.js SMOKE_TEST"
Write-Host "node .\AUTOMATION\Agent.js BUILD_CONNECTOR ORION"
