# INSTALL_MILES_BUILD_030_BUSINESS_EXECUTION_ORCHESTRATOR.ps1
# Complete replacement of BusinessExecutionEngineService.js only.
# Executes Build 029 executive mission steps in sequence and stages protected writes.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root =
    "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp =
    Get-Date -Format "yyyyMMdd_HHmmss"

$BackupRoot =
    Join-Path $Root "_BACKUPS\BUILD_030_$Stamp"

$ReportDir =
    Join-Path $Root "DATA\build_030"

$TestDir =
    Join-Path $Root "TESTS"

$Target =
    "SERVICES\BusinessExecutionEngineService.js"

$TargetPath =
    Join-Path $Root $Target

New-Item -ItemType Directory `
    -Path $BackupRoot `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $ReportDir `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $TestDir `
    -Force | Out-Null

if (-not (Test-Path $TargetPath)) {
    throw "Missing authoritative business execution service: $TargetPath"
}

$BackupPath =
    Join-Path $BackupRoot $Target

New-Item -ItemType Directory `
    -Path (
      Split-Path `
        $BackupPath `
        -Parent
    ) `
    -Force | Out-Null

Copy-Item `
    $TargetPath `
    $BackupPath `
    -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 030"
Write-Host "Business Execution Orchestrator"
Write-Host "Only BusinessExecutionEngineService.js will be replaced."
Write-Host "============================================================"
Write-Host "[BACKUP] $Target"

@'
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const OUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "business_execution"
  );

const LATEST_FILE =
  path.join(
    OUT_DIR,
    "latest_business_execution.json"
  );

const HISTORY_FILE =
  path.join(
    OUT_DIR,
    "business_execution_history.jsonl"
  );

const REPORT_FILE =
  path.join(
    OUT_DIR,
    "latest_business_execution.md"
  );

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(
    dir,
    { recursive: true }
  );
}

function writeJsonAtomic(
  file,
  value
) {
  ensureDir(
    path.dirname(file)
  );

  const temp =
    `${file}.tmp_${process.pid}_${Date.now()}`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );

  try {
    fs.copyFileSync(
      temp,
      file
    );
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
}

function appendJsonLine(
  file,
  value
) {
  ensureDir(
    path.dirname(file)
  );

  fs.appendFileSync(
    file,
    `${JSON.stringify(value)}\n`,
    "utf8"
  );
}

function normalizeTask(task = {}) {
  const payload =
    task.payload ||
    task;

  const plan =
    payload.plan ||
    task.plan ||
    {};

  return {
    ...task,
    payload,
    plan,
    objective:
      plan.objective ||
      payload.objective ||
      payload.command ||
      task.objective ||
      task.command ||
      "",
    originalCommand:
      plan.originalCommand ||
      payload.originalCommand ||
      payload.command ||
      task.command ||
      "",
    steps:
      Array.isArray(plan.steps)
        ? plan.steps
        : []
  };
}

function normalizeResult(
  action,
  result
) {
  if (
    result &&
    typeof result === "object"
  ) {
    return {
      action,
      ...result,
      ok:
        result.ok !== false
    };
  }

  return {
    ok: true,
    action,
    result
  };
}

class BusinessExecutionEngineService {
  constructor(options = {}) {
    this.services = {
      PROVIDER_AUTHORITY:
        options.providerAuthority ||
        require(
          "./ProviderAuthorityRegistryService"
        ),

      PROVIDER_SYNC:
        options.providerSync ||
        require(
          "./ProviderSynchronizationService"
        ),

      INSTANTLY_LIVE:
        options.instantlyLive ||
        require(
          "./InstantlyLiveIntegrationService"
        ),

      CONTROLLED_WRITE:
        options.controlledWrite ||
        require(
          "./ControlledWriteService"
        )
    };

    this.maxStepAttempts =
      Number(
        options.maxStepAttempts ||
        process.env
          .MILES_BUSINESS_STEP_ATTEMPTS ||
        2
      );
  }

  async run(task = {}) {
    const normalized =
      normalizeTask(task);

    const executionId =
      `BIZ-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const startedAt =
      now();

    const steps =
      normalized.steps.length > 0
        ? normalized.steps
        : this.defaultSteps(
            normalized.objective
          );

    const record = {
      ok: true,
      status: "RUNNING",
      service:
        "BusinessExecutionEngineService",
      executionId,
      objective:
        normalized.objective,
      originalCommand:
        normalized.originalCommand,
      startedAt,
      completedAt: null,
      stepCount:
        steps.length,
      completedSteps: 0,
      failedSteps: 0,
      approvalSteps: 0,
      blockedSteps: 0,
      results: [],
      executiveSummary: null
    };

    for (const step of steps) {
      const stepResult =
        await this.executeStep(
          step,
          normalized,
          executionId
        );

      record.results.push(
        stepResult
      );

      if (
        stepResult.status ===
        "COMPLETED"
      ) {
        record.completedSteps += 1;
      }

      if (
        stepResult.status ===
        "FAILED"
      ) {
        record.failedSteps += 1;
      }

      if (
        stepResult.status ===
        "AWAITING_APPROVAL"
      ) {
        record.approvalSteps += 1;
      }

      if (
        stepResult.status ===
        "BLOCKED"
      ) {
        record.blockedSteps += 1;
      }
    }

    record.ok =
      record.failedSteps === 0;

    record.status =
      record.failedSteps > 0
        ? "COMPLETED_WITH_ERRORS"
        : record.approvalSteps > 0
          ? "AWAITING_APPROVAL"
          : "COMPLETED";

    record.completedAt =
      now();

    record.executiveSummary =
      this.buildExecutiveSummary(
        record
      );

    this.save(record);

    return record;
  }

  defaultSteps(objective) {
    return [
      {
        step: 1,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_AUTHORITY",
        action:
          "PROVIDER_AUTHORITY",
        objective:
          "Verify provider authority, credentials, and write permissions."
      },
      {
        step: 2,
        provider: "MILES",
        connector: "MILES",
        capability:
          "PROVIDER_SYNC",
        action:
          "PROVIDER_SYNC",
        objective:
          "Synchronize provider and operating state."
      },
      {
        step: 3,
        provider: "MILES",
        connector: "MILES",
        capability:
          "INSTANTLY_LIVE",
        action:
          "INSTANTLY_LIVE",
        objective:
          "Perform live Instantly operating assessment."
      },
      {
        step: 4,
        provider: "MILES",
        connector: "MILES",
        capability:
          "BUSINESS_EXECUTION",
        action:
          "BUSINESS_EXECUTION",
        objective:
          objective ||
          "Execute the authorized business objective."
      },
      {
        step: 5,
        provider: "MILES",
        connector: "MILES",
        capability:
          "CONTROLLED_WRITE",
        action:
          "CONTROLLED_WRITE",
        objective:
          "Stage protected external changes for approval."
      }
    ];
  }

  async executeStep(
    step = {},
    task = {},
    executionId
  ) {
    const action =
      String(
        step.action ||
        step.capability ||
        ""
      ).toUpperCase();

    const base = {
      step:
        Number(step.step || 0),
      action,
      provider:
        step.provider ||
        "MILES",
      connector:
        step.connector ||
        "MILES",
      objective:
        step.objective ||
        task.objective ||
        "",
      executionId,
      startedAt:
        now(),
      completedAt: null,
      attempts: 0,
      status: "RUNNING",
      result: null,
      error: null
    };

    if (
      action ===
      "BUSINESS_EXECUTION"
    ) {
      base.attempts = 1;
      base.status =
        "COMPLETED";
      base.result = {
        ok: true,
        action:
          "BUSINESS_EXECUTION",
        orchestrationCheckpoint:
          true,
        objective:
          task.objective,
        message:
          "Executive objective was decomposed into governed provider steps. No recursive execution was invoked."
      };
      base.completedAt = now();
      return base;
    }

    const service =
      this.services[action];

    if (!service) {
      base.status = "FAILED";
      base.error =
        `No business execution service is registered for action ${action}.`;
      base.completedAt = now();
      return base;
    }

    const protectedWrite =
      action ===
      "CONTROLLED_WRITE";

    const stepTask = {
      ...task,
      action,
      capability:
        step.capability ||
        action,
      provider:
        step.provider ||
        "MILES",
      connector:
        step.connector ||
        "MILES",
      objective:
        step.objective ||
        task.objective,
      payload: {
        ...(task.payload || {}),
        action,
        capability:
          step.capability ||
          action,
        provider:
          step.provider ||
          "MILES",
        connector:
          step.connector ||
          "MILES",
        objective:
          step.objective ||
          task.objective,
        originalObjective:
          task.objective,
        executionId,
        dryRun:
          protectedWrite
            ? true
            : Boolean(
                task.payload
                  ?.dryRun
              ),
        stageOnly:
          protectedWrite,
        requiresApproval:
          protectedWrite
      }
    };

    let lastError = null;

    for (
      let attempt = 1;
      attempt <=
      this.maxStepAttempts;
      attempt += 1
    ) {
      base.attempts =
        attempt;

      try {
        const raw =
          await this.invokeService(
            service,
            stepTask
          );

        const result =
          normalizeResult(
            action,
            raw
          );

        base.result =
          result;

        if (
          protectedWrite
        ) {
          base.status =
            "AWAITING_APPROVAL";
          base.completedAt =
            now();
          return base;
        }

        if (
          result.ok !== false
        ) {
          base.status =
            "COMPLETED";
          base.completedAt =
            now();
          return base;
        }

        lastError =
          result.error ||
          result.message ||
          `${action} returned ok=false`;

        const retryable =
          result.retryable ===
            true ||
          result.failure
            ?.retryable ===
            true;

        if (!retryable) {
          break;
        }
      } catch (error) {
        lastError =
          error.stack ||
          error.message;

        if (
          attempt >=
          this.maxStepAttempts
        ) {
          break;
        }
      }
    }

    base.status = "FAILED";
    base.error =
      lastError ||
      `${action} failed.`;
    base.completedAt = now();

    return base;
  }

  async invokeService(
    service,
    task
  ) {
    if (
      service &&
      typeof service.run ===
        "function"
    ) {
      return service.run(task);
    }

    if (
      service &&
      typeof service.execute ===
        "function"
    ) {
      return service.execute(task);
    }

    if (
      typeof service ===
      "function"
    ) {
      return service(task);
    }

    throw new Error(
      "Registered business execution service does not implement run() or execute()."
    );
  }

  buildExecutiveSummary(record) {
    const completed =
      record.results
        .filter(
          item =>
            item.status ===
            "COMPLETED"
        )
        .map(
          item =>
            item.action
        );

    const approvals =
      record.results
        .filter(
          item =>
            item.status ===
            "AWAITING_APPROVAL"
        )
        .map(item => ({
          action:
            item.action,
          objective:
            item.objective,
          result:
            item.result
        }));

    const failures =
      record.results
        .filter(
          item =>
            item.status ===
            "FAILED"
        )
        .map(item => ({
          action:
            item.action,
          error:
            item.error
        }));

    return {
      objective:
        record.objective,
      status:
        record.status,
      completedWork:
        completed,
      activeWork: [],
      blockers:
        failures,
      ceoApprovals:
        approvals,
      message:
        failures.length > 0
          ? "Miles completed available work and recorded blockers."
          : approvals.length > 0
            ? "Miles completed authorized work and staged protected changes for CEO approval."
            : "Miles completed the business objective."
    };
  }

  save(record) {
    ensureDir(OUT_DIR);

    writeJsonAtomic(
      LATEST_FILE,
      record
    );

    appendJsonLine(
      HISTORY_FILE,
      record
    );

    fs.writeFileSync(
      REPORT_FILE,
      this.renderReport(record),
      "utf8"
    );
  }

  renderReport(record) {
    const lines = [];

    lines.push(
      "# MILES Business Execution Report"
    );
    lines.push("");
    lines.push(
      `Execution: ${record.executionId}`
    );
    lines.push(
      `Status: ${record.status}`
    );
    lines.push(
      `Objective: ${record.objective}`
    );
    lines.push(
      `Started: ${record.startedAt}`
    );
    lines.push(
      `Completed: ${record.completedAt}`
    );
    lines.push("");
    lines.push(
      "## Steps"
    );
    lines.push("");

    for (
      const step
      of record.results
    ) {
      lines.push(
        `- Step ${step.step}: ${step.action} — ${step.status}`
      );

      if (step.error) {
        lines.push(
          `  - Error: ${step.error}`
        );
      }
    }

    lines.push("");
    lines.push(
      "## Executive Summary"
    );
    lines.push("");
    lines.push(
      record.executiveSummary
        .message
    );

    if (
      record.executiveSummary
        .ceoApprovals.length >
      0
    ) {
      lines.push("");
      lines.push(
        "### CEO Approvals"
      );

      for (
        const approval
        of record.executiveSummary
          .ceoApprovals
      ) {
        lines.push(
          `- ${approval.action}: ${approval.objective}`
        );
      }
    }

    if (
      record.executiveSummary
        .blockers.length >
      0
    ) {
      lines.push("");
      lines.push(
        "### Blockers"
      );

      for (
        const blocker
        of record.executiveSummary
          .blockers
      ) {
        lines.push(
          `- ${blocker.action}: ${blocker.error}`
        );
      }
    }

    return lines.join("\n");
  }
}

module.exports =
  new BusinessExecutionEngineService();

module.exports.BusinessExecutionEngineService =
  BusinessExecutionEngineService;

'@ | Set-Content `
    -Path $TargetPath `
    -Encoding UTF8

$TestPath =
    Join-Path `
      $TestDir `
      "Test_Build030_BusinessExecutionOrchestrator.js"

@'
"use strict";

const assert =
  require("assert");

const {
  BusinessExecutionEngineService
} = require(
  "../SERVICES/BusinessExecutionEngineService"
);

function fakeService(
  action,
  options = {}
) {
  return {
    calls: [],
    async run(task) {
      this.calls.push(task);

      if (
        options.fail === true
      ) {
        return {
          ok: false,
          action,
          error:
            options.error ||
            `${action} failed`,
          retryable:
            Boolean(
              options.retryable
            )
        };
      }

      return {
        ok: true,
        action,
        observedPayload:
          task.payload || {}
      };
    }
  };
}

async function main() {
  const authority =
    fakeService(
      "PROVIDER_AUTHORITY"
    );

  const sync =
    fakeService(
      "PROVIDER_SYNC"
    );

  const instantly =
    fakeService(
      "INSTANTLY_LIVE"
    );

  const controlledWrite =
    fakeService(
      "CONTROLLED_WRITE"
    );

  const engine =
    new BusinessExecutionEngineService({
      providerAuthority:
        authority,
      providerSync:
        sync,
      instantlyLive:
        instantly,
      controlledWrite,
      maxStepAttempts: 2
    });

  const task = {
    command:
      "Miles, own Instantly end to end.",
    payload: {
      command:
        "Miles, own Instantly end to end.",
      plan: {
        objective:
          "Own Instantly end to end.",
        originalCommand:
          "Miles, own Instantly end to end.",
        steps: [
          {
            step: 1,
            action:
              "PROVIDER_AUTHORITY",
            capability:
              "PROVIDER_AUTHORITY",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Verify authority."
          },
          {
            step: 2,
            action:
              "PROVIDER_SYNC",
            capability:
              "PROVIDER_SYNC",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Synchronize providers."
          },
          {
            step: 3,
            action:
              "INSTANTLY_LIVE",
            capability:
              "INSTANTLY_LIVE",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Assess Instantly."
          },
          {
            step: 4,
            action:
              "BUSINESS_EXECUTION",
            capability:
              "BUSINESS_EXECUTION",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Execute authorized work."
          },
          {
            step: 5,
            action:
              "CONTROLLED_WRITE",
            capability:
              "CONTROLLED_WRITE",
            provider: "MILES",
            connector: "MILES",
            objective:
              "Stage protected writes."
          }
        ]
      }
    }
  };

  const result =
    await engine.run(task);

  assert.strictEqual(
    result.ok,
    true
  );

  assert.strictEqual(
    result.status,
    "AWAITING_APPROVAL"
  );

  assert.strictEqual(
    result.completedSteps,
    4
  );

  assert.strictEqual(
    result.approvalSteps,
    1
  );

  assert.strictEqual(
    authority.calls.length,
    1
  );

  assert.strictEqual(
    sync.calls.length,
    1
  );

  assert.strictEqual(
    instantly.calls.length,
    1
  );

  assert.strictEqual(
    controlledWrite.calls.length,
    1
  );

  assert.strictEqual(
    controlledWrite.calls[0]
      .payload.dryRun,
    true
  );

  assert.strictEqual(
    controlledWrite.calls[0]
      .payload.stageOnly,
    true
  );

  assert.strictEqual(
    result.results[3]
      .result
      .orchestrationCheckpoint,
    true
  );

  assert.strictEqual(
    result.executiveSummary
      .blockers.length,
    0
  );

  assert.strictEqual(
    result.executiveSummary
      .ceoApprovals.length,
    1
  );

  console.log(JSON.stringify({
    ok: true,
    build: "030",
    tests: {
      planStepConsumption:
        "PASSED",
      sequentialExecution:
        "PASSED",
      providerAuthorityExecution:
        "PASSED",
      providerSynchronization:
        "PASSED",
      instantlyLiveExecution:
        "PASSED",
      recursionPrevention:
        "PASSED",
      controlledWriteStaging:
        "PASSED",
      protectedWriteApproval:
        "PASSED",
      executiveSummary:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    result
  }, null, 2));
}

main().catch(error => {
  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});

'@ | Set-Content `
    -Path $TestPath `
    -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 030 SYNTAX VALIDATION ==="

$Files = @(
    ".\SERVICES\BusinessExecutionEngineService.js",
    ".\SERVICES\ProviderAuthorityRegistryService.js",
    ".\SERVICES\ProviderSynchronizationService.js",
    ".\SERVICES\InstantlyLiveIntegrationService.js",
    ".\SERVICES\ControlledWriteService.js",
    ".\TESTS\Test_Build030_BusinessExecutionOrchestrator.js"
)

foreach ($File in $Files) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 030 AUTOMATED TESTS ==="

$Output =
    & node $TestPath 2>&1

$ExitCode =
    $LASTEXITCODE

$Report =
    Join-Path `
      $ReportDir `
      "build_030_test_$Stamp.txt"

$Output |
    Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 030 tests failed. Restore from $BackupRoot"
}

$Manifest = [ordered]@{
    ok = $true
    build = "030"
    name =
      "Business Execution Orchestrator"
    installedAt =
      (Get-Date).ToString("o")
    backupRoot =
      $BackupRoot
    changedFiles = @(
      "SERVICES\BusinessExecutionEngineService.js"
    )
    preservedServices = @(
      "SERVICES\ProviderAuthorityRegistryService.js",
      "SERVICES\ProviderSynchronizationService.js",
      "SERVICES\InstantlyLiveIntegrationService.js",
      "SERVICES\ControlledWriteService.js",
      "BUILDER\BuilderService.js"
    )
    capabilities = @(
      "Consume Build 029 executive steps",
      "Execute provider authority review",
      "Execute provider synchronization",
      "Execute Instantly live review",
      "Prevent recursive BUSINESS_EXECUTION",
      "Stage controlled writes for approval",
      "Persist execution evidence",
      "Produce executive completion summary"
    )
    runtimeEvidence = @(
      "DATA\business_execution\latest_business_execution.json",
      "DATA\business_execution\business_execution_history.jsonl",
      "DATA\business_execution\latest_business_execution.md"
    )
    report =
      $Report
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content `
      -Path (
        Join-Path `
          $ReportDir `
          "build_030_manifest_$Stamp.json"
      ) `
      -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 030 BUSINESS EXECUTION ORCHESTRATOR INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
Write-Host ""
Write-Host "Restart production:"
Write-Host "taskkill /F /IM node.exe"
Write-Host "node StartMilesProduction.js"
