"use strict";

const fs = require("fs");
const path = require("path");
const { reconcile, normalizePath, runPm2 } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const fixture = path.join(ROOT, "SCRIPTS", "pm2-reconcile-fixture.js");

function apps() {
  const r = runPm2(["jlist"]);
  const parsed = JSON.parse(r.stdout || "[]");
  if (!Array.isArray(parsed)) throw new Error("PM2 jlist did not return an array");
  return parsed;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  fs.writeFileSync(fixture, '"use strict";\nsetInterval(() => {}, 1000);\n', "utf8");
  runPm2(["delete", "all"], true);
  const start = runPm2(["start", fixture, "--name", "legacy-api"], true);
  if (start.code !== 0) throw new Error(`Unable to create stale PM2 fixture: ${start.stderr || start.stdout}`);

  const before = apps();
  assert(before.some(app => app.name === "legacy-api"), "Stale legacy-api fixture was not registered");
  assert(!before.some(app => app.name === "miles-api"), "Canonical miles-api unexpectedly existed before repair");

  reconcile("miles-api", fixture, []);

  const after = apps();
  const canonical = after.filter(app => app.name === "miles-api");
  const stale = after.filter(app => app.name === "legacy-api");
  const sameScript = after.filter(app => normalizePath(app.pm2_env?.pm_exec_path) === normalizePath(fixture));

  assert(canonical.length === 1, `Expected exactly one canonical miles-api; found ${canonical.length}`);
  assert(canonical[0].pm2_env?.status === "online", `Canonical miles-api status=${canonical[0].pm2_env?.status}`);
  assert(Number(canonical[0].pid || 0) > 0, "Canonical miles-api has no live PID");
  assert(stale.length === 0, `legacy-api registration still exists (${stale.length})`);
  assert(sameScript.length === 1, `Expected exactly one registration for fixture script; found ${sameScript.length}`);

  console.log("[PM2 INTEGRATION PASS] stale script identity repaired without -f and without duplicates");
  process.exitCode = 0;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  runPm2(["delete", "miles-api"], true);
  runPm2(["delete", "legacy-api"], true);
  try { fs.unlinkSync(fixture); } catch {}
}
