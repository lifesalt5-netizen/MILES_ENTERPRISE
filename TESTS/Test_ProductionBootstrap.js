"use strict";

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "dotenv") {
    return { config: () => ({ parsed: {} }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildProcessPlan,
  tcpReady,
  waitForReadiness
} = require("../StartMilesProduction");

Module._load = originalLoad;

async function run() {
  let checks = 0;
  const check = (condition, message) => {
    assert.ok(condition, message);
    checks += 1;
  };

  const plan = buildProcessPlan({});
  assert.deepStrictEqual(
    plan.map(item => item.name),
    [
      "Worker Runtime",
      "Autonomous COO",
      "Miles Command Center",
      "Desktop UI",
      "Executive Dashboard"
    ]
  );
  checks += 1;

  assert.deepStrictEqual(plan.map(item => item.phase), [1, 2, 3, 4, 5]);
  checks += 1;

  check(plan[0].readiness[0].type === "json-status", "worker status gate");
  check(plan[0].readiness[1].port === 3000, "worker API gate");
  check(plan[1].readiness[0].type === "stable-process", "COO stability gate");
  check(plan[2].readiness[0].port === 8787, "command port gate");
  check(plan[3].readiness[0].port === 3737, "desktop port gate");
  check(plan[4].readiness[0].port === 8737, "dashboard port gate");

  const server = net.createServer(() => {});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  check(await tcpReady("127.0.0.1", address.port), "open port accepted");
  await new Promise(resolve => server.close(resolve));
  check(!(await tcpReady("127.0.0.1", address.port)), "closed port rejected");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-bootstrap-"));
  const statusDir = path.join(root, "DATA", "runtime");
  fs.mkdirSync(statusDir, { recursive: true });
  const statusPath = path.join(statusDir, "worker_runtime_status.json");
  const record = {
    proc: {
      name: "Worker Runtime",
      readiness: [{
        type: "json-status",
        relativePath: path.join("DATA", "runtime", "worker_runtime_status.json")
      }]
    },
    child: { pid: 43210 },
    startedAtMs: Date.now(),
    exited: false,
    startError: null
  };

  fs.writeFileSync(statusPath, JSON.stringify({
    ok: true,
    pid: 11111,
    lifecycle: { started: true, shuttingDown: false }
  }));

  setTimeout(() => {
    fs.writeFileSync(statusPath, JSON.stringify({
      ok: true,
      pid: 43210,
      lifecycle: { started: true, shuttingDown: false }
    }));
  }, 50);

  await waitForReadiness(root, record, { timeoutMs: 1000, pollMs: 10 });
  checks += 1;

  record.proc.readiness = [{ type: "stable-process", durationMs: 25 }];
  await waitForReadiness(root, record, { timeoutMs: 500, pollMs: 5 });
  checks += 1;

  record.exited = true;
  await assert.rejects(
    () => waitForReadiness(root, record, { timeoutMs: 100, pollMs: 5 }),
    /exited before readiness/
  );
  checks += 1;

  fs.rmSync(root, { recursive: true, force: true });

  assert.strictEqual(checks, 13);
  console.log("PRODUCTION_BOOTSTRAP_TEST_PASS 13/13");
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
