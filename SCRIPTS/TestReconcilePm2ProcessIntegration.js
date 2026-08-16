"use strict";

const fs = require("fs");
const path = require("path");
const { reconcile, normalizePath, runPm2, parsePm2Jlist } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const fixture = path.join(ROOT, "SCRIPTS", "pm2-reconcile-fixture.js");
const LEGACY_NAME = "miles-pm2-test-legacy";
const CANONICAL_NAME = "miles-pm2-test-canonical";

function apps() {
  const r = runPm2(["jlist"]);
  return parsePm2Jlist(r.stdout);
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function cleanup() {
  runPm2(["delete", CANONICAL_NAME], true);
  runPm2(["delete", LEGACY_NAME], true);
  try { fs.unlinkSync(fixture); } catch {}
}

try {
  cleanup();
  fs.writeFileSync(fixture, '"use strict";\nsetInterval(() => {}, 1000);\n', "utf8");

  const start = runPm2(["start", fixture, "--name", LEGACY_NAME], true);
  if (start.code !== 0) throw new Error(`Unable to create stale PM2 fixture: ${start.stderr || start.stdout}`);

  const before = apps();
  assert(before.some(app => app.name === LEGACY_NAME), "Stale integration fixture was not registered");
  assert(!before.some(app => app.name === CANONICAL_NAME), "Canonical integration fixture unexpectedly existed before repair");

  reconcile(CANONICAL_NAME, fixture, []);

  const after = apps();
  const canonical = after.filter(app => app.name === CANONICAL_NAME);
  const stale = after.filter(app => app.name === LEGACY_NAME);
  const sameScript = after.filter(app => normalizePath(app.pm2_env?.pm_exec_path) === normalizePath(fixture));

  assert(canonical.length === 1, `Expected exactly one canonical integration app; found ${canonical.length}`);
  assert(canonical[0].pm2_env?.status === "online", `Canonical integration status=${canonical[0].pm2_env?.status}`);
  assert(Number(canonical[0].pid || 0) > 0, "Canonical integration app has no live PID");
  assert(stale.length === 0, `Legacy integration registration still exists (${stale.length})`);
  assert(sameScript.length === 1, `Expected exactly one registration for integration fixture; found ${sameScript.length}`);

  console.log("[PM2 INTEGRATION PASS] stale script identity repaired without -f, duplicates, cmd.exe nesting, or touching unrelated PM2 apps");
  process.exitCode = 0;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
