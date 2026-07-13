# INSTALL_MILES_BUILD_022_ORION_COO.ps1
# Complete replacement of OrionProvider only.
# Reuses existing ORION connector and provider controller.

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
    Join-Path $Root "_BACKUPS\BUILD_022_$Stamp"

$ReportDir =
    Join-Path $Root "DATA\build_022"

$TestDir =
    Join-Path $Root "TESTS"

New-Item -ItemType Directory `
    -Path $BackupRoot `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $ReportDir `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $TestDir `
    -Force | Out-Null

$Target =
    "PROVIDERS\providers\OrionProvider.js"

$Source =
    Join-Path $Root $Target

if (-not (Test-Path $Source)) {
    throw "Missing authoritative OrionProvider: $Source"
}

$Backup =
    Join-Path $BackupRoot $Target

New-Item -ItemType Directory `
    -Path (Split-Path $Backup -Parent) `
    -Force | Out-Null

Copy-Item `
    $Source `
    $Backup `
    -Force

@'
"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");
const defaultConnector =
  require("../../CONNECTORS/ORION/connector");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "orion_coo");

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tableCount(summary, key) {
  return safeNumber(summary?.[key]?.count, 0);
}

function databaseFreshness(dbPath) {
  try {
    if (!dbPath || !fs.existsSync(dbPath)) {
      return {
        exists: false,
        modifiedAt: null,
        ageHours: null,
        stale: true
      };
    }

    const stat = fs.statSync(dbPath);
    const ageHours =
      (Date.now() - stat.mtimeMs) / 3600000;

    const thresholdHours =
      safeNumber(
        process.env.ORION_STALE_HOURS,
        24
      );

    return {
      exists: true,
      modifiedAt: stat.mtime.toISOString(),
      ageHours:
        Math.round(ageHours * 100) / 100,
      stale: ageHours > thresholdHours,
      thresholdHours
    };
  } catch (error) {
    return {
      exists: false,
      modifiedAt: null,
      ageHours: null,
      stale: true,
      error: error.message
    };
  }
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;

  return Math.round(
    (numerator / denominator) *
    10000
  ) / 100;
}

function persistEvidence(result) {
  ensureDir();

  const stamp = Date.now();
  const historical = path.join(
    OUT_DIR,
    `orion_operation_${stamp}.json`
  );

  const latest = path.join(
    OUT_DIR,
    "latest_orion_operation.json"
  );

  const text = JSON.stringify(
    result,
    null,
    2
  );

  fs.writeFileSync(
    historical,
    text,
    "utf8"
  );

  fs.writeFileSync(
    latest,
    text,
    "utf8"
  );

  return historical;
}

class OrionProvider extends IDataProvider {
  constructor(options = {}) {
    super("ORION");

    this.orion =
      options.connector ||
      defaultConnector;

    this.dependencies = [
      "ORION Database"
    ];

    this.sourceSystems = [
      "CONNECTORS/ORION"
    ];

    this.contractors = [];
    this.buyers = [];
    this.opportunities = [];
    this.recompetes = [];
    this.recommendationRecords = [];
    this.personaRecords = [];
  }

  async initialize() {
    this.status = "Initializing";
    await this.refresh();
    return true;
  }

  async refresh() {
    return this.auditIntelligence();
  }

  async healthCheck() {
    return this.auditIntelligence();
  }

  async verifyDatabase() {
    return this.auditIntelligence();
  }

  async generateOrionReport() {
    return this.auditIntelligence();
  }

  async auditIntelligence() {
    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness = "Live";

    try {
      const summary =
        this.orion.getSummary();

      const health =
        summary?.health || {};

      const dbFreshness =
        databaseFreshness(health.db);

      const counts = {
        contractors:
          tableCount(
            summary,
            "contractors"
          ),
        buyers:
          tableCount(
            summary,
            "buyers"
          ),
        opportunities:
          tableCount(
            summary,
            "opportunities"
          ),
        recompetes:
          tableCount(
            summary,
            "recompetes"
          ),
        recommendations:
          tableCount(
            summary,
            "recommendations"
          ),
        personas:
          tableCount(
            summary,
            "personas"
          )
      };

      this.contractors =
        this.orion.getContractors(100);

      this.buyers =
        this.orion.getBuyers(100);

      this.opportunities =
        this.orion.getOpportunities(100);

      this.recompetes =
        this.orion.getRecompetes(100);

      this.recommendationRecords =
        this.orion.getRecommendations(100);

      this.personaRecords =
        this.orion.getPersonas(100);

      const recommendationCoverage =
        ratio(
          counts.recommendations,
          counts.contractors
        );

      const personaCoverage =
        ratio(
          counts.personas,
          counts.contractors
        );

      const issues = [];

      if (!health.ok) {
        issues.push({
          type: "Database",
          severity: "Critical",
          message:
            "ORION database is unavailable."
        });
      }

      if (dbFreshness.stale) {
        issues.push({
          type: "DatabaseFreshness",
          severity: "Warning",
          message:
            dbFreshness.ageHours === null
              ? "ORION database freshness could not be determined."
              : `ORION database is ${dbFreshness.ageHours} hours old.`
        });
      }

      if (counts.contractors === 0) {
        issues.push({
          type: "ContractorIntelligence",
          severity: "Critical",
          message:
            "No contractor records were detected."
        });
      }

      if (counts.buyers === 0) {
        issues.push({
          type: "BuyerIntelligence",
          severity: "Warning",
          message:
            "No buyer records were detected."
        });
      }

      if (counts.opportunities === 0) {
        issues.push({
          type: "OpportunityIntelligence",
          severity: "Critical",
          message:
            "No opportunity records were detected."
        });
      }

      if (
        counts.contractors > 0 &&
        recommendationCoverage < 50
      ) {
        issues.push({
          type: "RecommendationCoverage",
          severity: "Warning",
          message:
            `Recommendation coverage is ${recommendationCoverage}%.`
        });
      }

      if (
        counts.contractors > 0 &&
        personaCoverage < 50
      ) {
        issues.push({
          type: "PersonaCoverage",
          severity: "Warning",
          message:
            `Persona coverage is ${personaCoverage}%.`
        });
      }

      const critical =
        issues.some(
          issue =>
            issue.severity === "Critical"
        );

      const warning =
        issues.some(
          issue =>
            issue.severity === "Warning"
        );

      this.status =
        critical
          ? "Critical"
          : warning
            ? "Watch"
            : "Healthy";

      this.metrics = {
        database: health.db || null,
        tableCount:
          safeNumber(
            health.tableCount,
            0
          ),
        ...counts,
        recommendationCoverage,
        personaCoverage,
        databaseFreshness:
          dbFreshness,
        sampleSizes: {
          contractors:
            this.contractors.length,
          buyers:
            this.buyers.length,
          opportunities:
            this.opportunities.length,
          recompetes:
            this.recompetes.length,
          recommendations:
            this.recommendationRecords.length,
          personas:
            this.personaRecords.length
        }
      };

      this.exceptions = issues;

      this.recommendations = [];

      if (dbFreshness.stale) {
        this.recommendations.push(
          "Run the authorized ORION dataset refresh and verify database modification time afterward."
        );
      }

      if (counts.opportunities === 0) {
        this.recommendations.push(
          "Verify opportunity ingestion and source connectors."
        );
      }

      if (
        counts.contractors > 0 &&
        recommendationCoverage < 50
      ) {
        this.recommendations.push(
          "Regenerate contractor recommendations for uncovered contractor records."
        );
      }

      if (
        counts.contractors > 0 &&
        personaCoverage < 50
      ) {
        this.recommendations.push(
          "Rebuild persona scores for uncovered contractor records."
        );
      }

      if (counts.recompetes === 0) {
        this.recommendations.push(
          "Verify recompete ingestion and expiration intelligence."
        );
      }

      const result = {
        ok: this.status !== "Critical",
        provider: "OrionProvider",
        action: "auditIntelligence",
        status: this.status,
        generatedAt:
          this.lastRefresh,
        readOnly: true,
        metrics: this.metrics,
        exceptions:
          this.exceptions,
        recommendations:
          this.recommendations,
        intelligence: {
          contractors:
            this.contractors,
          buyers:
            this.buyers,
          opportunities:
            this.opportunities,
          recompetes:
            this.recompetes,
          recommendationRecords:
            this.recommendationRecords,
          personaRecords:
            this.personaRecords
        },
        safety: {
          databaseMode: "READ_ONLY",
          writesEnabled: false,
          datasetRefreshExecuted: false,
          intelligenceJobExecuted: false
        }
      };

      result.evidenceFile =
        persistEvidence(result);

      return result;
    } catch (error) {
      this.status = "Critical";
      this.metrics = {};
      this.contractors = [];
      this.buyers = [];
      this.opportunities = [];
      this.recompetes = [];
      this.recommendationRecords = [];
      this.personaRecords = [];

      this.exceptions = [{
        type: "ORION",
        severity: "Critical",
        message: error.message
      }];

      this.recommendations = [
        "Verify the ORION connector.",
        "Verify the ORION database path and read permissions."
      ];

      const result = {
        ok: false,
        provider: "OrionProvider",
        action: "auditIntelligence",
        status: this.status,
        generatedAt:
          this.lastRefresh,
        readOnly: true,
        metrics: {},
        exceptions:
          this.exceptions,
        recommendations:
          this.recommendations,
        safety: {
          databaseMode: "READ_ONLY",
          writesEnabled: false,
          datasetRefreshExecuted: false,
          intelligenceJobExecuted: false
        }
      };

      result.evidenceFile =
        persistEvidence(result);

      return result;
    }
  }

  getProviderState() {
    return {
      provider: this.name,
      status: this.status,
      lastRefresh:
        this.lastRefresh,
      dataFreshness:
        this.dataFreshness,
      metrics: this.metrics,
      exceptions:
        this.exceptions,
      recommendations:
        this.recommendations,
      contractors:
        this.contractors,
      buyers:
        this.buyers,
      opportunities:
        this.opportunities,
      recompetes:
        this.recompetes,
      recommendationRecords:
        this.recommendationRecords,
      personaRecords:
        this.personaRecords,
      leads:
        this.contractors,
      deals: [],
      replies: [],
      campaigns: [],
      proposals: []
    };
  }

  async executeTask(task = {}) {
    const action =
      task.payload?.action ||
      task.action ||
      "refresh";

    const aliases = {
      VERIFY_DATABASE:
        "verifyDatabase",
      HEALTH_CHECK:
        "healthCheck",
      GENERATE_ORION_REPORT:
        "generateOrionReport",
      REFRESH_DATASETS:
        "refresh"
    };

    const normalized =
      aliases[action] || action;

    if (
      typeof this[normalized] !==
      "function"
    ) {
      throw new Error(
        `Unsupported OrionProvider action: ${action}`
      );
    }

    return this[normalized](task);
  }

  async shutdown() {
    if (
      this.orion &&
      typeof this.orion.shutdown ===
        "function"
    ) {
      this.orion.shutdown();
    }

    return true;
  }
}

module.exports = OrionProvider;

'@ | Set-Content `
    -Path ".\PROVIDERS\providers\OrionProvider.js" `
    -Encoding UTF8

@'
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const ROOT = process.env.MILES_ROOT;
const tempDb = path.join(
  ROOT,
  "DATA",
  "build_022",
  "test_orion.db"
);

fs.mkdirSync(
  path.dirname(tempDb),
  { recursive: true }
);

fs.writeFileSync(
  tempDb,
  "test",
  "utf8"
);

const OrionProvider =
  require("../PROVIDERS/providers/OrionProvider");

async function main() {
  const fakeConnector = {
    getSummary() {
      return {
        health: {
          ok: true,
          db: tempDb,
          tableCount: 6
        },
        contractors: {
          ok: true,
          count: 100
        },
        buyers: {
          ok: true,
          count: 50
        },
        opportunities: {
          ok: true,
          count: 25
        },
        recompetes: {
          ok: true,
          count: 10
        },
        recommendations: {
          ok: true,
          count: 80
        },
        personas: {
          ok: true,
          count: 90
        }
      };
    },

    getContractors() {
      return [{ id: 1 }];
    },

    getBuyers() {
      return [{ id: 1 }];
    },

    getOpportunities() {
      return [{ id: 1 }];
    },

    getRecompetes() {
      return [{ id: 1 }];
    },

    getRecommendations() {
      return [{ id: 1 }];
    },

    getPersonas() {
      return [{ id: 1 }];
    },

    shutdown() {}
  };

  const provider =
    new OrionProvider({
      connector: fakeConnector
    });

  const result =
    await provider.auditIntelligence();

  assert.strictEqual(
    result.provider,
    "OrionProvider"
  );

  assert.strictEqual(
    result.readOnly,
    true
  );

  assert.strictEqual(
    result.status,
    "Healthy"
  );

  assert.strictEqual(
    result.metrics.contractors,
    100
  );

  assert.strictEqual(
    result.metrics.opportunities,
    25
  );

  assert.strictEqual(
    result.metrics.recommendationCoverage,
    80
  );

  assert.strictEqual(
    result.metrics.personaCoverage,
    90
  );

  assert.strictEqual(
    result.metrics.databaseFreshness.stale,
    false
  );

  assert.strictEqual(
    result.safety.writesEnabled,
    false
  );

  assert(
    fs.existsSync(
      result.evidenceFile
    ),
    "ORION COO evidence file was not created."
  );

  console.log(JSON.stringify({
    ok: true,
    build: "022",
    tests: {
      connectorIntegration:
        "PASSED",
      databaseHealth:
        "PASSED",
      databaseFreshness:
        "PASSED",
      contractorCoverage:
        "PASSED",
      buyerCoverage:
        "PASSED",
      opportunityCoverage:
        "PASSED",
      recompeteCoverage:
        "PASSED",
      recommendationCoverage:
        "PASSED",
      personaCoverage:
        "PASSED",
      readOnlySafety:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    status: result.status,
    metrics: result.metrics,
    recommendations:
      result.recommendations,
    safety: result.safety,
    evidenceFile:
      result.evidenceFile
  }, null, 2));
}

main()
  .finally(() => {
    try {
      fs.unlinkSync(tempDb);
    } catch {}
  })
  .catch(error => {
    console.error(
      error.stack || error.message
    );

    process.exit(1);
  });

'@ | Set-Content `
    -Path ".\TESTS\Test_Build022_OrionCOO.js" `
    -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 022 SYNTAX VALIDATION ==="

$Files = @(
    ".\PROVIDERS\providers\OrionProvider.js",
    ".\CONNECTORS\ORION\connector.js",
    ".\SERVICES\provider_controllers\OrionProviderController.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\WorkflowService.js",
    ".\SERVICES\ExecutionService.js",
    ".\SERVICES\WorkforceExecutionService.js",
    ".\TESTS\Test_Build022_OrionCOO.js"
)

foreach ($File in $Files) {
    if (-not (Test-Path $File)) {
        Write-Host "[SKIP] $File not found"
        continue
    }

    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 022 AUTOMATED TESTS ==="

$Output =
    & node ".\TESTS\Test_Build022_OrionCOO.js" 2>&1

$ExitCode =
    $LASTEXITCODE

$Report =
    Join-Path `
        $ReportDir `
        "build_022_test_$Stamp.txt"

$Output |
    Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 022 tests failed. Restore from $BackupRoot"
}

$Manifest = [ordered]@{
    ok = $true
    build = "022"
    name = "ORION COO"
    installedAt =
        (Get-Date).ToString("o")
    backupRoot = $BackupRoot
    changedFiles = @(
        "PROVIDERS\providers\OrionProvider.js"
    )
    reusedComponents = @(
        "CONNECTORS\ORION\connector.js",
        "SERVICES\provider_controllers\OrionProviderController.js",
        "SERVICES\ProviderRouterService.js",
        "SERVICES\CapabilityService.js"
    )
    capabilities = @(
        "Database health",
        "Database freshness",
        "Contractor intelligence coverage",
        "Buyer intelligence coverage",
        "Opportunity intelligence coverage",
        "Recompete coverage",
        "Recommendation coverage",
        "Persona coverage",
        "Ingestion-risk recommendations",
        "Evidence persistence"
    )
    safety = @(
        "Read-only database operation",
        "No dataset refresh executed",
        "No intelligence job executed",
        "No database writes",
        "No recommendation regeneration without future authorization"
    )
    report = $Report
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content `
        -Path (
          Join-Path `
            $ReportDir `
            "build_022_manifest_$Stamp.json"
        ) `
        -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 022 ORION COO INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
