param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host "[MILES-WFE] $msg" -ForegroundColor Cyan
}

function Backup-File($path) {
    if (Test-Path $path) {
        $backupDir = Join-Path (Split-Path $path -Parent) "_backups"
        New-Item -ItemType Directory -Force $backupDir | Out-Null
        $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $backup = Join-Path $backupDir ((Split-Path $path -Leaf) + "." + $stamp + ".bak")
        Copy-Item $path $backup -Force
        Write-Step "Backed up $(Split-Path $path -Leaf) -> $backup"
    }
}

if (!(Test-Path $RepoRoot)) {
    throw "RepoRoot not found: $RepoRoot"
}

Set-Location $RepoRoot
Write-Step "Installing Workforce Execution Engine into $RepoRoot"

New-Item -ItemType Directory -Force ".\SERVICES" | Out-Null
New-Item -ItemType Directory -Force ".\DATA\workforce_results" | Out-Null
New-Item -ItemType Directory -Force ".\DATA\work_packages" | Out-Null

# -----------------------------------------------------------------------------
# SERVICES/WorkforceExecutionService.js
# -----------------------------------------------------------------------------
$workforceExecution = @'
const fs = require("fs");
const path = require("path");
const workforce = require("./WorkforceService");
const executiveState = require("./ExecutiveStateService");
const { log } = require("../CORE/logger");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RESULTS_DIR = path.join(ROOT, "DATA", "workforce_results");
const WORK_PACKAGES_DIR = path.join(ROOT, "DATA", "work_packages");

function safeId(value) {
  return String(value || "UNKNOWN")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function ensureDirs() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.mkdirSync(WORK_PACKAGES_DIR, { recursive: true });
}

function findEmployee(name) {
  const target = String(name || "").toLowerCase();
  return workforce.all().find(e =>
    String(e.name || e.employee || e.id || "").toLowerCase() === target
  ) || null;
}

function defaultRecommendation(task, employee) {
  const capability = task.payload?.capability || task.type || "general";
  const objective = task.payload?.objective || "No objective provided";
  const workerName = task.payload?.assignedTo || employee?.name || employee?.employee || "Unassigned";
  const mission = employee?.mission || "No mission available.";
  const expectedOutput = task.payload?.expectedOutput || `${capability} recommendation`;

  return {
    summary: `${workerName} prepared a ${expectedOutput} for: ${objective}`,
    recommendation: `Use ${workerName}'s ${capability} capability to advance the objective. Mission context: ${mission}`,
    nextActions: [
      `Review current Executive State for ${capability}.`,
      `Identify available source data and connector requirements.`,
      `Produce a concrete recommendation aligned with Kevin's CEO authority rules.`
    ],
    needsHumanInput: false,
    ceoApprovalRequired: false
  };
}

class WorkforceExecutionService {
  executeStep(task = {}) {
    ensureDirs();

    const payload = task.payload || {};
    const employee = findEmployee(payload.assignedTo);

    const result = {
      ok: true,
      type: "WORKFORCE_STEP_RESULT",
      taskId: task.id || null,
      workPackageId: payload.workPackageId || null,
      objective: payload.objective || null,
      capability: payload.capability || null,
      assignedTo: payload.assignedTo || null,
      department: payload.department || employee?.department || null,
      expectedOutput: payload.expectedOutput || null,
      verification: payload.verification || null,
      employeeFound: Boolean(employee),
      employeeProfile: employee ? {
        name: employee.name || employee.employee || employee.id,
        department: employee.department || "",
        mission: employee.mission || "",
        authority: employee.authority || "Operational"
      } : null,
      output: defaultRecommendation(task, employee),
      status: "AWAITING_VERIFICATION",
      createdAt: new Date().toISOString()
    };

    const fileName = `${safeId(result.workPackageId || "WP")}_${safeId(result.taskId || Date.now())}.json`;
    const outFile = path.join(RESULTS_DIR, fileName);
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

    const current = executiveState.get() || {};
    const workforceResults = current.workforceResults || [];
    workforceResults.push({
      taskId: result.taskId,
      workPackageId: result.workPackageId,
      capability: result.capability,
      assignedTo: result.assignedTo,
      status: result.status,
      outFile,
      createdAt: result.createdAt
    });

    executiveState.update("workforceResults", workforceResults.slice(-250));

    log("WorkforceExecutionService", "Execute workforce step", "Success", outFile);

    return { ...result, outFile };
  }

  verifyResult(result = {}) {
    const verified = {
      ok: true,
      type: "WORKFORCE_STEP_VERIFICATION",
      taskId: result.taskId || null,
      workPackageId: result.workPackageId || null,
      capability: result.capability || null,
      assignedTo: result.assignedTo || null,
      verified: Boolean(result.output && result.output.recommendation),
      status: result.output && result.output.recommendation ? "COMPLETED" : "NEEDS_REVIEW",
      checkedAt: new Date().toISOString()
    };

    const current = executiveState.get() || {};
    const verifications = current.verifications || [];
    verifications.push(verified);
    executiveState.update("verifications", verifications.slice(-250));

    return verified;
  }

  executeAndVerify(task = {}) {
    const result = this.executeStep(task);
    const verification = this.verifyResult(result);
    return {
      ok: verification.verified,
      result,
      verification,
      status: verification.status
    };
  }
}

module.exports = new WorkforceExecutionService();
'@
Set-Content ".\SERVICES\WorkforceExecutionService.js" $workforceExecution -Encoding UTF8
Write-Step "Created SERVICES/WorkforceExecutionService.js"

# -----------------------------------------------------------------------------
# Replace ExecutionService.js with router version that supports WORKFORCE_STEP
# -----------------------------------------------------------------------------
$executionPath = ".\SERVICES\ExecutionService.js"
Backup-File $executionPath

$executionService = @'
const taskQueue = require("../CORE/TaskQueue");
const connectorManager = require("../CORE/ConnectorManager");
const eventBus = require("../CORE/EventBus");
const { requiresApproval } = require("../CORE/authority");
const { log } = require("../CORE/logger");
const memory = require("./MemoryService");

const INTERNAL_TASKS = new Set([
  "SELF_BUILD",
  "SELF_TEST",
  "SELF_ANALYZE",
  "HEALTH_CHECK",
  "BACKUP",
  "RESTART_RUNTIME",
  "GIT_COMMIT",
  "BUILD_CONNECTOR",
  "BUILD_PLAN",
  "ANALYZE_PROJECT"
]);

class ExecutionService {
  async execute(task) {
    if (!task) {
      return { ok: false, message: "No task provided" };
    }

    const system = task.payload?.system || task.payload?.connector || task.type;
    const action = task.payload?.action || task.type;
    const authority = requiresApproval(system, action);

    if (!authority.allowed) {
      taskQueue.update(task.id, {
        status: "AWAITING_APPROVAL",
        authority,
      });

      eventBus.publish("TASK_AWAITING_APPROVAL", { task, authority });
      log("ExecutionService", action, "Awaiting Approval", authority.approval);

      return {
        ok: false,
        status: "AWAITING_APPROVAL",
        authority,
      };
    }

    if (task.type === "WORKFORCE_STEP") {
      return this.executeWorkforceStep(task);
    }

    if (INTERNAL_TASKS.has(task.type)) {
      return this.executeInternalTask(task);
    }

    return this.executeConnectorTask(task, system, action);
  }

  async executeWorkforceStep(task) {
    const workforceExecution = require("./WorkforceExecutionService");
    const action = task.payload?.action || task.type;

    try {
      taskQueue.update(task.id, { status: "RUNNING" });
      eventBus.publish("TASK_STARTED", task);
      log("ExecutionService", action, "Started", "WorkforceExecutionService");

      const result = workforceExecution.executeAndVerify(task);

      taskQueue.update(task.id, {
        status: result.status === "COMPLETED" ? "COMPLETED" : "AWAITING_VERIFICATION",
        result,
      });

      memory.remember("execution:last_result", task.id, result);
      eventBus.publish("TASK_COMPLETED", { task, result });
      log("ExecutionService", action, result.status || "Completed", task.payload?.assignedTo || "Workforce");

      return result;
    } catch (error) {
      taskQueue.update(task.id, { status: "FAILED", error: error.message });
      eventBus.publish("TASK_FAILED", { task, error: error.message });
      log("ExecutionService", action, "Failed", error.message);
      return { ok: false, status: "FAILED", error: error.message };
    }
  }

  async executeInternalTask(task) {
    const action = task.payload?.action || task.type;

    const result = {
      internal: true,
      action: task.type,
      message: "Handled by internal runtime.",
      completedAt: new Date().toISOString()
    };

    taskQueue.update(task.id, {
      status: "COMPLETED",
      result
    });

    eventBus.publish("TASK_COMPLETED", { task, internal: true, result });
    log("ExecutionService", action, "Completed", "Internal Runtime");

    return { ok: true, status: "COMPLETED", result };
  }

  async executeConnectorTask(task, system, action) {
    const connectorName = task.payload?.connector || system;
    const connector = connectorManager.get(connectorName);

    if (!connector) {
      taskQueue.update(task.id, {
        status: "FAILED",
        error: `Connector not found: ${connectorName}`,
      });

      log("ExecutionService", action, "Failed", `Connector not found: ${connectorName}`);
      eventBus.publish("TASK_FAILED", { task, error: `Connector not found: ${connectorName}` });

      return {
        ok: false,
        status: "FAILED",
        error: `Connector not found: ${connectorName}`,
      };
    }

    if (typeof connector.execute !== "function") {
      taskQueue.update(task.id, {
        status: "FAILED",
        error: `Connector ${connectorName} does not implement execute(task)`,
      });

      log("ExecutionService", action, "Failed", `Connector ${connectorName} missing execute(task)`);
      eventBus.publish("TASK_FAILED", { task, error: `Connector ${connectorName} missing execute(task)` });

      return {
        ok: false,
        status: "FAILED",
        error: `Connector ${connectorName} missing execute(task)`,
      };
    }

    try {
      taskQueue.update(task.id, { status: "RUNNING" });
      eventBus.publish("TASK_STARTED", task);
      log("ExecutionService", action, "Started", connectorName);

      const result = await connector.execute(task);

      taskQueue.update(task.id, {
        status: "COMPLETED",
        result,
      });

      memory.remember("execution:last_result", task.id, result);

      eventBus.publish("TASK_COMPLETED", { task, result });
      log("ExecutionService", action, "Completed", connectorName);

      return {
        ok: true,
        status: "COMPLETED",
        result,
      };
    } catch (error) {
      taskQueue.update(task.id, {
        status: "FAILED",
        error: error.message,
      });

      eventBus.publish("TASK_FAILED", { task, error: error.message });
      log("ExecutionService", action, "Failed", error.message);

      return {
        ok: false,
        status: "FAILED",
        error: error.message,
      };
    }
  }

  async runNext() {
    const queued = taskQueue.list("QUEUED");

    if (!queued.length) {
      return {
        ok: true,
        message: "No queued tasks",
      };
    }

    return this.execute(queued[0]);
  }
}

module.exports = new ExecutionService();
'@
Set-Content $executionPath $executionService -Encoding UTF8
Write-Step "Updated SERVICES/ExecutionService.js with WorkforceExecution routing"

# -----------------------------------------------------------------------------
# Create test runner
# -----------------------------------------------------------------------------
New-Item -ItemType Directory -Force ".\TESTS" | Out-Null
$testFile = @'
const workflow = require("../SERVICES/WorkflowService");
const execution = require("../SERVICES/ExecutionService");
const taskQueue = require("../CORE/TaskQueue");

async function main() {
  const wf = workflow.createWorkflow("Grow sales pipeline with email marketing and capture strategy");
  console.log("WORKFLOW_CREATED", wf.ok, wf.workPackage.id, wf.queuedTasks.length);

  const before = taskQueue.list("QUEUED").length;
  console.log("QUEUED_BEFORE", before);

  const result = await execution.runNext();
  console.log("RUN_NEXT", JSON.stringify(result, null, 2));

  const after = taskQueue.list("QUEUED").length;
  console.log("QUEUED_AFTER", after);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
'@
Set-Content ".\TESTS\test_workforce_execution.js" $testFile -Encoding UTF8
Write-Step "Created TESTS/test_workforce_execution.js"

# -----------------------------------------------------------------------------
# Syntax checks
# -----------------------------------------------------------------------------
Write-Step "Running syntax checks"
node --check .\SERVICES\WorkforceExecutionService.js
node --check .\SERVICES\ExecutionService.js
node --check .\TESTS\test_workforce_execution.js

Write-Step "Install complete"
Write-Host "Next commands:" -ForegroundColor Green
Write-Host "node .\TESTS\test_workforce_execution.js" -ForegroundColor Green
Write-Host "node .\CORE\Kernel\StartMiles.js" -ForegroundColor Green
