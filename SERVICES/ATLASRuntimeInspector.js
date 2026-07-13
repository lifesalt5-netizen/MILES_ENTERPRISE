"use strict";

/*
==========================================================
 MILES OS
 ATLAS Runtime Inspector
 Production Runtime Intelligence
 Version: 2.0.1
==========================================================
*/

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function run(cmd) {
  try {
    const result = child_process.execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    return String(result || "").trim();

  } catch (err) {

    if (err.stdout) {
      return String(err.stdout).trim();
    }

    if (err.stderr) {
      return String(err.stderr).trim();
    }

    return err.message || String(err);
  }
}

class ATLASRuntimeInspector {

  constructor() {

    this.name = "ATLAS_V2_RUNTIME_INTELLIGENCE";
    this.version = "2.0.1";

  }

  inspect() {

    const report = {

      ok: true,

      version: this.version,

      generatedAt: now(),

      root: ROOT,

      pm2: this.inspectPM2(),

      runtime: this.inspectRuntime(),

      architecture: this.validateArchitecture(),

      recommendations: []

    };

    report.recommendations = this.buildRecommendations(report);

    this.persist(report);

    return report;

  }

  inspectPM2() {

    return {

      list: run("pm2 list"),

      describe: run("pm2 describe MILES")

    };

  }

  inspectRuntime() {

    const cooWorker = read(
      path.join(ROOT, "workers", "cooWorker.js")
    );

    const startFile = read(
      path.join(ROOT, "StartProductionSystem.js")
    );

    return {

      startupFile: "StartProductionSystem.js",

      startupLoadsCooWorker:
        startFile.includes("./workers/cooWorker"),

      startupLoadsRevenueWorker:
        startFile.includes("./workers/revenueWorker"),

      startupLoadsDealWorker:
        startFile.includes("./workers/dealWorker"),

      startupLoadsAtlasWorker:
        startFile.includes("./workers/atlasWorker"),

      startupLoadsCommandWorker:
        startFile.includes("./workers/commandWorker"),

      startupEmitsCOOTick:
        startFile.includes("COO_TICK"),

      cooWorkerUsesAutonomous:
        cooWorker.includes("AutonomousCOOLoopService"),

      cooWorkerHasLegacyFallback:

        cooWorker.includes("ProductionCOOEngine_FALLBACK") ||

        cooWorker.includes("ProductionCOOEngine"),

      cooWorkerPrimaryEngine:

        cooWorker.includes("AutonomousCOOLoopService")

          ? "AutonomousCOOLoopService"

          : "UNKNOWN",

      cooWorkerFallbackEngine:

        cooWorker.includes("ProductionCOOEngine")

          ? "ProductionCOOEngine"

          : null

    };

  }

  validateArchitecture() {

    const checks = {

      startProductionExists:
        exists("StartProductionSystem.js"),

      eventBusExists:
        exists("event-bus/emitter.js"),

      cooWorkerExists:
        exists("workers/cooWorker.js"),

      revenueWorkerExists:
        exists("workers/revenueWorker.js"),

      dealWorkerExists:
        exists("workers/dealWorker.js"),

      replyWorkerExists:
        exists("workers/replyWorker.js"),

      atlasWorkerExists:
        exists("workers/atlasWorker.js"),

      commandWorkerExists:
        exists("workers/commandWorker.js"),

      autonomousCOOExists:
        exists("SERVICES/AutonomousCOOLoopService.js"),

      executiveIntelligenceExists:
        exists("SERVICES/ExecutiveIntelligenceService.js"),

      businessAggregatorExists:
        exists("SERVICES/BusinessStateAggregator.js"),

      revenueLoopExists:
        exists("SERVICES/AutonomousRevenueClosureLoop.js"),

      commandQueueExists:
        exists("CORE/CommandQueue.js"),

      orionConnectorExists:
        exists("CONNECTORS/ORION/connector.js")

    };

    const runtime = this.inspectRuntime();

    const drift = [];

    const warnings = [];

    if (!runtime.cooWorkerUsesAutonomous) {

      drift.push({

        severity: "CRITICAL",

        issue:
          "COO worker is not using AutonomousCOOLoopService"

      });

    }

    if (
      runtime.cooWorkerHasLegacyFallback &&
      runtime.cooWorkerUsesAutonomous
    ) {

      warnings.push({

        severity: "INFO",

        issue:
          "COO worker contains ProductionCOOEngine fallback, but AutonomousCOOLoopService is primary"

      });

    }

    if (!runtime.startupLoadsCooWorker) {

      drift.push({

        severity: "HIGH",

        issue:
          "Startup system does not load cooWorker"

      });

    }

    if (!runtime.startupLoadsAtlasWorker) {

      drift.push({

        severity: "MEDIUM",

        issue:
          "Startup system does not load atlasWorker"

      });

    }

    if (!runtime.startupEmitsCOOTick) {

      drift.push({

        severity: "HIGH",

        issue:
          "Startup system does not emit COO_TICK"

      });

    }

    for (const [key, value] of Object.entries(checks)) {

      if (!value) {

        drift.push({

          severity: "HIGH",

          issue:
            `Missing architecture component: ${key}`

        });

      }

    }

    return {

      ok: drift.length === 0,

      expected: {

        cooEngine:
          "AutonomousCOOLoopService",

        startupFile:
          "StartProductionSystem.js",

        event:
          "COO_TICK"

      },

      actual: runtime,

      checks,

      drift,

      warnings

    };

  }

  buildRecommendations(report) {

    const recs = [];

    for (const d of report.architecture.drift || []) {

      recs.push({

        priority: 1,

        type: "ARCHITECTURE_DRIFT",

        issue: d.issue,

        action:
          "Create engineering ticket and repair automatically under Governance v3."

      });

    }

    for (const w of report.architecture.warnings || []) {

      recs.push({

        priority: 3,

        type: "ARCHITECTURE_WARNING",

        issue: w.issue,

        action:
          "Monitor. No immediate repair required."

      });

    }

    if (recs.length === 0) {

      recs.push({

        priority: 3,

        type: "SYSTEM_HEALTH",

        issue:
          "No critical architecture drift detected",

        action:
          "Continue monitoring."

      });

    }

    return recs;

  }

  persist(report) {

    const dir = path.join(
      ROOT,
      "DATA",
      "runtime"
    );

    fs.mkdirSync(dir, {
      recursive: true
    });

    fs.writeFileSync(

      path.join(
        dir,
        "atlas_runtime_report.json"
      ),

      JSON.stringify(report, null, 2)

    );

  }

}

module.exports = new ATLASRuntimeInspector();