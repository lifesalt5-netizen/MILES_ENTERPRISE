"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { reconcile, normalizePath } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const PM2 = process.platform === "win32" ? "pm2.cmd" : "pm2";
const fixture = path.join(ROOT, "SCRIPTS", "pm2-reconcile-fixture.js");

function run(args, allowFailure = false) {
  const r = spawnSync(PM2, args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.error && !allowFailure) throw r.error;
  if ((r.status || 0) !== 0 && !allowFailure) throw new Error(`pm2 ${args.join(" ")} failed: ${out}`);
  return { code: r.status || 0, out };
}

function apps() {
  const r = run(["jlist"]);
  const parsed = JSON.parse(r.out || "[]");
  if (!Array.isArray(parsed)) throw new Error("PM2 jlist did not return an array");
  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  fs.writeFileSync(fixture, '"use strict";\nsetInterval(() => {}, 1000);\n', "utf8");
  run(["delete", "all"], true);
  run(["start", fixture, "--name", "legacy-api"]);

  let before = apps();
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
  run(["delete", "miles-api"], true);
  run(["delete", "legacy-api"], true);
  try { fs.unlinkSync(fixture); } catch {}
}
