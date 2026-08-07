"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WorkerRegistry = require("../SERVICES/worker_runtime/WorkerRegistry");
const WorkerDispatcher = require("../SERVICES/worker_runtime/WorkerDispatcher");
const WorkerRuntime = require("../SERVICES/worker_runtime/WorkerRuntime");
const WorkerRuntimeManager = require("../SERVICES/worker_runtime/WorkerRuntimeManager");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}
function worker(result = { ok: true, status: "DONE" }) {
  return {
    service: "TEST_WORKER",
    executions: 0,
    async execute(operation) {
      this.executions += 1;
      return { ...result, operation };
    },
    async healthCheck() {
      return { ok: true, status: "HEALTHY" };
    },
  };
}

(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-worker-lifecycle-"),
  );
  try {
    const empty = new WorkerRegistry({ rootDir: root });
    await test("WorkerRuntime exports a constructable runtime", () =>
      assert.strictEqual(
        new WorkerRuntime({ rootDir: root, registry: empty }).service,
        "WORKER_RUNTIME",
      ));
    await test("empty registry fails health closed", async () =>
      assert.strictEqual((await empty.healthCheck()).ok, false));
    await test("metadata-only registration is rejected", () =>
      assert.strictEqual(
        empty.register("metadata", { version: "1" }).status,
        "WORKER_NOT_EXECUTABLE",
      ));

    const live = worker();
    await test("live worker registers", () =>
      assert.strictEqual(
        empty.register("RevenueWorker", live).status,
        "WORKER_REGISTERED",
      ));
    await test("lookup is case insensitive", () =>
      assert.strictEqual(empty.getWorker("revenueworker"), live));
    await test("same worker registration is idempotent", () =>
      assert.strictEqual(
        empty.register("REVENUEWORKER", live).status,
        "WORKER_ALREADY_REGISTERED",
      ));
    const conflict = worker();
    await test("different worker cannot overwrite a live name", () =>
      assert.strictEqual(
        empty.register("revenueworker", conflict).status,
        "WORKER_REGISTRATION_CONFLICT",
      ));
    await test("conflict preserves original worker", () =>
      assert.strictEqual(empty.getWorker("RevenueWorker"), live));
    await test("registry persistence contains one live registration", () => {
      const data = JSON.parse(
        fs.readFileSync(
          path.join(
            root,
            "runtime",
            "worker_registry",
            "registered_workers.json",
          ),
          "utf8",
        ),
      );
      assert.strictEqual(data.workers.length, 1);
    });

    const restartedRegistry = new WorkerRegistry({ rootDir: root });
    await test("restart does not rehydrate metadata as executable code", () =>
      assert.strictEqual(restartedRegistry.listWorkers().length, 0));
    await test("restart preserves registration evidence separately", () =>
      assert.strictEqual(restartedRegistry.persistedWorkers.size, 1));
    await test("restart remains degraded until live code registers", async () =>
      assert.strictEqual((await restartedRegistry.healthCheck()).ok, false));

    const restartedWorker = worker();
    restartedRegistry.register("RevenueWorker", restartedWorker);
    const dispatcher = new WorkerDispatcher({
      rootDir: root,
      registry: restartedRegistry,
    });
    const runtime = new WorkerRuntime({
      rootDir: root,
      registry: restartedRegistry,
      dispatcher,
    });
    await test("runtime starts only with live workers", async () =>
      assert.strictEqual((await runtime.start()).ok, true));
    await test("registered worker dispatch completes", async () =>
      assert.strictEqual(
        (
          await runtime.executeWorker({
            worker: "REVENUEWORKER",
            action: "NOOP",
          })
        ).ok,
        true,
      ));
    await test("unknown worker fails deterministically", async () =>
      assert.strictEqual(
        (await runtime.executeWorker({ worker: "missingWorker" })).reason,
        "WORKER_NOT_FOUND",
      ));

    dispatcher.state.ok = true;
    dispatcher.state.status = "RUNNING";
    const manager = new WorkerRuntimeManager({
      rootDir: root,
      registry: restartedRegistry,
      dispatcher,
      runtime,
      pollIntervalMs: 60000,
    });
    const beforeStart = restartedWorker.executions;
    await test("manager starts the runtime", async () =>
      assert.strictEqual((await manager.start()).ok, true));
    await test("worker metadata is never executed as queued work", () =>
      assert.strictEqual(restartedWorker.executions, beforeStart));
    await test("duplicate manager start is prevented", async () =>
      assert.strictEqual((await manager.start()).status, "ALREADY_RUNNING"));
    await test("running manager reports healthy", async () =>
      assert.strictEqual((await manager.healthCheck()).ok, true));
    await test("manager stops runtime cleanly", async () => {
      await manager.stop();
      assert.strictEqual(runtime.running, false);
    });
    await test("stopped runtime rejects execution", async () =>
      assert.strictEqual(
        (await runtime.executeWorker({ worker: "RevenueWorker" })).status,
        "RUNTIME_NOT_RUNNING",
      ));

    const hostSource = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "SERVICES",
        "digital_coo",
        "DigitalCOOHost.js",
      ),
      "utf8",
    );
    await test("Digital COO requires worker runtime manager at startup", () =>
      assert.match(hostSource, /["']workerRuntimeManager["'],[\s\S]{0,80}true/));
    await test("Digital COO required health cannot be skipped", () =>
      assert.match(
        hostSource,
        /status: required \? ["']REQUIRED_COMPONENT_UNAVAILABLE["']/,
      ));

    const commandCenterSource = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "SERVICES",
        "digital_coo",
        "MilesCommandCenter.js",
      ),
      "utf8",
    );
    await test("Command Center rejects failed Digital COO startup", () =>
      assert.match(commandCenterSource, /if \(!hostStart \|\| hostStart\.ok === false\)/));
    await test("Command Center exposes worker lifecycle health", () =>
      assert.match(commandCenterSource, /req\.url === '\/api\/health'/));

    console.log(`WORKER_LIFECYCLE_TEST_PASS ${passed}/${passed}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
