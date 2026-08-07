"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const ExecutiveRuntimeHealthService =
  require("../SERVICES/digital_coo/ExecutiveRuntimeHealthService");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "dotenv") {
    return { config: () => ({ parsed: {} }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  ProductionBootstrapSupervisor
} = require("../StartMilesProduction");

Module._load = originalLoad;

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function healthyBootstrap(generatedAt) {
  const names = [
    "Worker Runtime",
    "Autonomous COO",
    "Miles Command Center",
    "Desktop UI",
    "Executive Dashboard"
  ];

  return {
    ok: true,
    service: "MILES_PRODUCTION_BOOTSTRAP",
    startupComplete: true,
    shuttingDown: false,
    generatedAt,
    services: names.map((name, index) => ({
      name,
      running: true,
      ready: true,
      pid: 1000 + index,
      restartCount: index === 0 ? 1 : 0
    }))
  };
}

function healthyWorker(generatedAt) {
  return {
    ok: true,
    pid: 2000,
    generatedAt,
    lifecycle: {
      started: true,
      shuttingDown: false
    },
    queue: {
      total: 10,
      queued: 1,
      running: 1,
      completed: 6,
      failed: 1,
      awaitingApproval: 1,
      other: 0,
      healthScore: 100
    },
    resolutionHealth: {
      ok: true,
      checkedAt: generatedAt,
      providerRegistry: {
        ok: true,
        validation: { providerCount: 5 }
      },
      capabilityRegistry: {
        ok: true,
        capabilityCount: 8
      },
      connectorRegistry: {
        ok: true,
        connectorCount: 3
      },
      routing: {
        ok: true
      }
    }
  };
}

(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-gate5-")
  );
  const runtimeDir = path.join(root, "DATA", "runtime");
  const bootstrapPath = path.join(
    runtimeDir,
    "production_bootstrap_status.json"
  );
  const workerPath = path.join(
    runtimeDir,
    "worker_runtime_status.json"
  );
  const nowMs = Date.now();
  const current = new Date(nowMs).toISOString();

  try {
    writeJson(bootstrapPath, healthyBootstrap(current));
    writeJson(workerPath, healthyWorker(current));

    const healthService = new ExecutiveRuntimeHealthService({
      rootDir: root,
      now: () => nowMs,
      maxAgeMs: 60000
    });

    const healthy = await healthService.healthCheck();

    await test("executive runtime health is constructable", () =>
      assert.strictEqual(
        healthService.service,
        "EXECUTIVE_RUNTIME_HEALTH"
      ));

    await test("current complete production evidence is healthy", () =>
      assert.strictEqual(healthy.ok, true));

    await test("all five production runtimes are required", () => {
      assert.strictEqual(
        healthy.components.productionRuntime.readyCount,
        5
      );
      assert.strictEqual(
        healthy.components.productionRuntime.serviceCount,
        5
      );
    });

    await test("runtime restart evidence is reported", () =>
      assert.strictEqual(
        healthy.components.productionRuntime.restartCount,
        1
      ));

    await test("worker lifecycle is reported", () =>
      assert.strictEqual(
        healthy.components.workerRuntime.ok,
        true
      ));

    await test("historical failed tasks do not degrade a valid queue", () => {
      assert.strictEqual(healthy.components.queue.ok, true);
      assert.strictEqual(
        healthy.components.queue.counts.failed,
        1
      );
    });

    await test("provider capability connector and routing health is reported", () => {
      assert.strictEqual(healthy.components.providers.ok, true);
      assert.deepStrictEqual(
        healthy.components.providers.components,
        {
          providerRegistry: true,
          capabilityRegistry: true,
          connectorRegistry: true,
          routing: true
        }
      );
    });

    fs.unlinkSync(bootstrapPath);
    await test("missing bootstrap evidence fails closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck()).ok,
        false
      ));

    writeJson(
      bootstrapPath,
      healthyBootstrap(
        new Date(nowMs - 120000).toISOString()
      )
    );
    await test("stale bootstrap evidence fails closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck())
          .components.productionRuntime.status,
        "SNAPSHOT_STALE"
      ));

    writeJson(bootstrapPath, healthyBootstrap(current));
    const stoppedWorker = healthyWorker(current);
    stoppedWorker.lifecycle.started = false;
    writeJson(workerPath, stoppedWorker);
    await test("stopped worker runtime fails closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck())
          .components.workerRuntime.ok,
        false
      ));

    const invalidQueue = healthyWorker(current);
    invalidQueue.queue.total = 999;
    writeJson(workerPath, invalidQueue);
    await test("inconsistent queue counts fail closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck())
          .components.queue.ok,
        false
      ));

    const invalidProvider = healthyWorker(current);
    invalidProvider.resolutionHealth.providerRegistry.ok = false;
    writeJson(workerPath, invalidProvider);
    await test("provider degradation fails closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck())
          .components.providers.ok,
        false
      ));

    const invalidConnector = healthyWorker(current);
    invalidConnector.resolutionHealth.connectorRegistry.ok = false;
    writeJson(workerPath, invalidConnector);
    await test("connector degradation fails closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck())
          .components.providers.ok,
        false
      ));

    fs.writeFileSync(workerPath, "{not-json", "utf8");
    await test("malformed runtime evidence fails closed", async () =>
      assert.strictEqual(
        (await healthService.healthCheck()).ok,
        false
      ));

    const persistedPath = path.join(
      runtimeDir,
      "test_bootstrap_status.json"
    );
    const supervisor = new ProductionBootstrapSupervisor({
      root,
      processes: [],
      statusFile: persistedPath,
      env: {
        MILES_BOOTSTRAP_HEARTBEAT_MS: "60000"
      },
      log: () => {}
    });

    await supervisor.startAll();
    await test("production supervisor persists executive status", () => {
      const persisted = JSON.parse(
        fs.readFileSync(persistedPath, "utf8")
      );
      assert.strictEqual(persisted.startupComplete, true);
      assert.strictEqual(persisted.shuttingDown, false);
    });
    await supervisor.shutdown("TEST");

    const hostSource = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "SERVICES",
        "digital_coo",
        "DigitalCOOHost.js"
      ),
      "utf8"
    );

    await test("Digital COO health requires executive runtime health", () => {
      assert.match(
        hostSource,
        /executiveRuntimeHealth:[\s\S]{0,100}true/
      );
      assert.match(
        hostSource,
        /executiveRuntime:\s*components\.executiveRuntimeHealth/
      );
    });

    console.log(
      `RUNTIME_HEALTH_TEST_PASS ${passed}/16`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
