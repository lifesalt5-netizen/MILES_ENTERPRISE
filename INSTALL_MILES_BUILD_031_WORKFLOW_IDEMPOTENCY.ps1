# INSTALL_MILES_BUILD_031_WORKFLOW_IDEMPOTENCY.ps1
# Replaces only queueAuthorizedWorkflows() in AutonomousCOOLoopService.js.
# Purpose:
#   Prevent the same authorized work item from generating duplicate workflows
#   on every autonomous COO cycle.
#
# Behavior:
#   - Reloads the work queue before selection.
#   - Processes only Pending, authorized workflow items.
#   - Creates one workflow.
#   - Persists the originating work item as Queued.
#   - Verifies the persisted status after marking.
#   - Falls back to updateStatus() or direct queue persistence if markQueued()
#     does not update the item.
#   - Skips any work item that already contains a workflow package reference.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
$Target = Join-Path $Root "SERVICES\AutonomousCOOLoopService.js"

if (-not (Test-Path $Target)) {
    throw "Missing target file: $Target"
}

Set-Location $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $Root "_BACKUPS\BUILD_031_$Stamp"
$ReportDir = Join-Path $Root "DATA\build_031"
$TestDir = Join-Path $Root "TESTS"

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null

$BackupFile = Join-Path $BackupDir "SERVICES\AutonomousCOOLoopService.js"
New-Item -ItemType Directory -Path (Split-Path $BackupFile -Parent) -Force | Out-Null
Copy-Item $Target $BackupFile -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 031"
Write-Host "Workflow Idempotency and Persistent Queue Handoff"
Write-Host "Target: SERVICES\AutonomousCOOLoopService.js"
Write-Host "============================================================"
Write-Host "[BACKUP] $BackupFile"

$Source = Get-Content $Target -Raw

$NewMethod = @'
  queueAuthorizedWorkflows() {
    console.log("[D015] ==================================");
    console.log("[D015] queueAuthorizedWorkflows() entered");

    if (this.workQueue && typeof this.workQueue.load === "function") {
      try {
        this.workQueue.load();
        console.log("[D015] WorkQueue reloaded before authorization check.");
      } catch (reloadErr) {
        console.error("[D015] WorkQueue reload failed:", reloadErr.message);
      }
    }

    const allItems =
      this.workQueue && typeof this.workQueue.getAll === "function"
        ? this.workQueue.getAll()
        : this.workQueue && typeof this.workQueue.list === "function"
          ? this.workQueue.list()
          : [];

    const authorized =
      this.workQueue && typeof this.workQueue.getAuthorizedPending === "function"
        ? this.workQueue.getAuthorizedPending() || []
        : (allItems || []).filter(item =>
            item &&
            item.status === "Pending" &&
            item.requiresKevin !== true &&
            item.executionType !== "APPROVAL_REQUIRED"
          );

    const stats =
      this.workQueue && typeof this.workQueue.getStats === "function"
        ? this.workQueue.getStats()
        : {};

    console.log("[D015] Queue Stats:", JSON.stringify(stats, null, 2));
    console.log(`[D015] Total Work Items: ${(allItems || []).length}`);
    console.log(`[D015] Authorized Pending: ${authorized.length}`);

    const results = [];

    for (const item of authorized) {
      try {
        if (!item || !item.id) {
          console.log("[D015] SKIPPED malformed work item.");
          continue;
        }

        if (item.status !== "Pending") {
          console.log(
            `[D015] SKIPPED ${item.id} because status='${item.status}'`
          );
          continue;
        }

        const existingWorkflowResult =
          item.metadata && item.metadata.workflowResult
            ? item.metadata.workflowResult
            : null;

        const existingWorkPackageId =
          existingWorkflowResult?.workPackage?.id ||
          existingWorkflowResult?.workPackageId ||
          item.metadata?.workPackageId ||
          null;

        if (existingWorkPackageId) {
          console.log(
            `[D015] SKIPPED ${item.id}; workflow already exists as ${existingWorkPackageId}.`
          );

          this.persistQueuedState(item.id, {
            queuedBy: "AutonomousCOOLoopService",
            queuedAt: item.metadata?.queuedAt || now(),
            workflowStatus:
              existingWorkflowResult?.status || "QUEUED",
            workPackageId: existingWorkPackageId,
            workflowResult: existingWorkflowResult,
            idempotencyReason:
              "Existing workflow package detected before dispatch."
          });

          results.push({
            ok: true,
            skippedDuplicate: true,
            workItemId: item.id,
            title: item.title,
            workPackageId: existingWorkPackageId
          });

          continue;
        }

        const objective =
          item.recommendedAction ||
          item.title ||
          item.description ||
          "Execute authorized work item";

        const context = {
          sourceWorkItemId: item.id,
          area: item.area,
          priority: item.priority,
          description: item.description,
          reason: item.reason,
          recommendedAction: item.recommendedAction,
          expectedImpact: item.expectedImpact,
          relatedProvider: item.relatedProvider,
          metadata: item.metadata || {},
          runtimeCycleId:
            item.metadata?.missionItem?.metadata?.cycleId ||
            item.metadata?.cycleId ||
            null
        };

        console.log(
          `[D015] Work Item: ${item.id} | Status=${item.status} | Title=${item.title}`
        );
        console.log(
          `[D015] Calling WorkflowService.createWorkflow("${objective}")`
        );

        const workflowResult =
          this.workflowService.createWorkflow(objective, context);

        const workPackageId =
          workflowResult?.workPackage?.id ||
          workflowResult?.workPackageId ||
          null;

        const queuedTasks =
          Array.isArray(workflowResult?.queuedTasks)
            ? workflowResult.queuedTasks.length
            : Number(workflowResult?.queuedTasks || 0);

        console.log(
          "[D015] Workflow Result:",
          JSON.stringify(
            {
              status: workflowResult?.status,
              queuedTasks,
              workPackageId
            },
            null,
            2
          )
        );

        const persisted =
          this.persistQueuedState(item.id, {
            queuedBy: "AutonomousCOOLoopService",
            queuedAt: now(),
            workflowStatus: workflowResult?.status || "QUEUED",
            workPackageId,
            workflowResult,
            sourceWorkItemId: item.id
          });

        if (!persisted || persisted.status !== "Queued") {
          throw new Error(
            `Failed to persist work item ${item.id} as Queued after workflow creation.`
          );
        }

        results.push({
          ok: true,
          workItemId: item.id,
          title: item.title,
          workflowStatus: workflowResult?.status || "UNKNOWN",
          queuedTasks,
          workPackageId,
          persistedStatus: persisted.status
        });
      } catch (err) {
        console.error(`[D015] FAILED Work Item ${item?.id || "UNKNOWN"}`);
        console.error(err);

        if (
          item &&
          item.id &&
          this.workQueue &&
          typeof this.workQueue.markFailed === "function"
        ) {
          this.workQueue.markFailed(item.id, {
            failedBy: "AutonomousCOOLoopService",
            error: err.message,
            failedAt: now()
          });
        }

        results.push({
          ok: false,
          workItemId: item?.id || null,
          title: item?.title || null,
          error: err.message
        });
      }
    }

    console.log(
      `[D015] queueAuthorizedWorkflows() complete. Results=${results.length}`
    );
    console.log("[D015] ==================================");

    return results;
  }

  persistQueuedState(id, metadata = {}) {
    if (!this.workQueue || !id) {
      return null;
    }

    let updated = null;

    if (typeof this.workQueue.markQueued === "function") {
      updated = this.workQueue.markQueued(id, metadata);
    }

    if ((!updated || updated.status !== "Queued") &&
        typeof this.workQueue.updateStatus === "function") {
      updated = this.workQueue.updateStatus(
        id,
        "Queued",
        metadata,
        "Workflow created and queued exactly once."
      );
    }

    if (!updated || updated.status !== "Queued") {
      const rows =
        typeof this.workQueue.getAll === "function"
          ? this.workQueue.getAll()
          : Array.isArray(this.workQueue.queue)
            ? this.workQueue.queue
            : [];

      const item = (rows || []).find(row => row && row.id === id);

      if (item) {
        item.status = "Queued";
        item.updatedAt = now();
        item.metadata = {
          ...(item.metadata || {}),
          ...metadata
        };

        if (typeof this.workQueue.save === "function") {
          this.workQueue.save();
        }

        updated = item;
      }
    }

    if (typeof this.workQueue.load === "function") {
      try {
        this.workQueue.load();
      } catch {}
    }

    const verified =
      typeof this.workQueue.getAll === "function"
        ? (this.workQueue.getAll() || []).find(row => row && row.id === id)
        : updated;

    return verified || updated;
  }

'@

$Pattern = '(?s)  queueAuthorizedWorkflows\(\) \{.*?\r?\n  async runExecutionPasses\(\) \{'

if ($Source -notmatch $Pattern) {
    throw "Could not locate queueAuthorizedWorkflows() through runExecutionPasses() boundary."
}

$Replacement = $NewMethod + "  async runExecutionPasses() {"

$Updated = [regex]::Replace(
    $Source,
    $Pattern,
    [System.Text.RegularExpressions.MatchEvaluator]{
        param($match)
        return $Replacement
    },
    1
)

Set-Content -Path $Target -Value $Updated -Encoding UTF8

$TestPath = Join-Path $TestDir "Test_Build031_WorkflowIdempotency.js"

@'
"use strict";

const assert = require("assert");
const AutonomousCOOLoopService =
  require("../SERVICES/AutonomousCOOLoopService");

class FakeWorkQueue {
  constructor() {
    this.items = [
      {
        id: "WORK-1",
        status: "Pending",
        title: "Repair Website: Conversion",
        recommendedAction: "Verify website health",
        requiresKevin: false,
        executionType: "WORKFLOW",
        metadata: {}
      }
    ];
  }

  load() {}

  getAll() {
    return this.items;
  }

  getStats() {
    return {
      total: this.items.length,
      pending: this.items.filter(x => x.status === "Pending").length,
      queued: this.items.filter(x => x.status === "Queued").length
    };
  }

  getAuthorizedPending() {
    return this.items.filter(
      x =>
        x.status === "Pending" &&
        x.requiresKevin !== true &&
        x.executionType !== "APPROVAL_REQUIRED"
    );
  }

  markQueued(id, metadata = {}) {
    const item = this.items.find(x => x.id === id);
    if (!item) return null;
    item.status = "Queued";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  updateStatus(id, status, metadata = {}) {
    const item = this.items.find(x => x.id === id);
    if (!item) return null;
    item.status = status;
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  save() {}
}

function main() {
  const queue = new FakeWorkQueue();
  let workflowCalls = 0;

  const workflowService = {
    createWorkflow(objective, context) {
      workflowCalls += 1;
      return {
        status: "QUEUED",
        queuedTasks: [{ id: "TASK-1" }],
        workPackage: {
          id: "WP-1"
        }
      };
    }
  };

  const loop = new AutonomousCOOLoopService({
    workQueue: queue,
    workflowService,
    enableExecution: false,
    enableWorkflowQueueing: true
  });

  const first = loop.queueAuthorizedWorkflows();

  assert.strictEqual(workflowCalls, 1);
  assert.strictEqual(queue.items[0].status, "Queued");
  assert.strictEqual(queue.items[0].metadata.workPackageId, "WP-1");
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].persistedStatus, "Queued");

  const second = loop.queueAuthorizedWorkflows();

  assert.strictEqual(
    workflowCalls,
    1,
    "Second authorization pass must not create a duplicate workflow."
  );

  assert.strictEqual(second.length, 0);

  console.log(JSON.stringify({
    ok: true,
    build: "031",
    tests: {
      firstWorkflowCreated: "PASSED",
      originatingWorkItemMarkedQueued: "PASSED",
      workPackagePersisted: "PASSED",
      secondPassSkipsQueuedItem: "PASSED",
      duplicateWorkflowPrevented: "PASSED"
    },
    workItem: queue.items[0],
    workflowCalls
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
'@ | Set-Content -Path $TestPath -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 031 SYNTAX VALIDATION ==="

$Files = @(
    ".\SERVICES\AutonomousCOOLoopService.js",
    ".\SERVICES\WorkQueueService.js",
    ".\SERVICES\WorkflowService.js",
    ".\TESTS\Test_Build031_WorkflowIdempotency.js"
)

foreach ($File in $Files) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 031 AUTOMATED TESTS ==="

$Output = & node $TestPath 2>&1
$ExitCode = $LASTEXITCODE
$Report = Join-Path $ReportDir "build_031_test_$Stamp.txt"

$Output | Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 031 tests failed. Restore from $BackupFile"
}

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 031 WORKFLOW IDEMPOTENCY INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupFile"
Write-Host "Report: $Report"
Write-Host ""
Write-Host "Restart production:"
Write-Host "taskkill /F /IM node.exe"
Write-Host "node StartMilesProduction.js"
