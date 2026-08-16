"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const PM2 = process.platform === "win32" ? "pm2.cmd" : "pm2";

function normalizePath(value) {
  if (!value) return "";
  const resolved = path.resolve(String(value));
  return process.platform === "win32"
    ? resolved.replace(/\//g, "\\").toLowerCase()
    : resolved;
}

function appPath(app) {
  return normalizePath(app && app.pm2_env && app.pm2_env.pm_exec_path);
}

function normalizeArgs(value) {
  if (Array.isArray(value)) return value.map(v => String(v));
  if (value == null || value === "") return [];
  return [String(value)];
}

function argsEqual(a, b) {
  const left = normalizeArgs(a);
  const right = normalizeArgs(b);
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

function runPm2(args, allowFailure = false) {
  const result = spawnSync(PM2, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    windowsHide: true
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const code = typeof result.status === "number" ? result.status : 1;
  if (result.error && !allowFailure) throw result.error;
  if (code !== 0 && !allowFailure) {
    throw new Error(`pm2 ${args.join(" ")} failed (${code}): ${stderr || stdout}`.trim());
  }
  return { code, stdout, stderr };
}

function readApps() {
  const r = runPm2(["jlist"]);
  try {
    const apps = JSON.parse(r.stdout || "[]");
    if (!Array.isArray(apps)) throw new Error("not an array");
    return apps;
  } catch (error) {
    throw new Error(`Unable to parse PM2 jlist: ${error.message}\n${r.stdout}\n${r.stderr}`.trim());
  }
}

function buildPlan(apps, name, scriptPath, scriptArgs = []) {
  const targetPath = normalizePath(scriptPath);
  const desiredArgs = normalizeArgs(scriptArgs);
  const named = apps.find(app => String(app.name) === String(name)) || null;
  const sameScript = apps.filter(app => appPath(app) === targetPath);
  const deleteIds = [];
  if (named && (appPath(named) !== targetPath || !argsEqual(named.pm2_env?.args, desiredArgs))) deleteIds.push(named.pm_id);
  for (const app of sameScript) {
    if (String(app.name) !== String(name)) deleteIds.push(app.pm_id);
  }
  return {
    targetPath,
    namedCorrect: Boolean(named && appPath(named) === targetPath && argsEqual(named.pm2_env?.args, desiredArgs)),
    desiredArgs,
    deleteIds: [...new Set(deleteIds.filter(v => v !== undefined && v !== null))]
  };
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(250, end - Date.now()));
  }
}

function waitForOnline(name, scriptPath, timeoutMs = 20000) {
  const targetPath = normalizePath(scriptPath);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const apps = readApps();
    last = apps.find(app => String(app.name) === String(name)) || null;
    if (last && appPath(last) === targetPath && last.pm2_env?.status === "online" && Number(last.pid || 0) > 0) {
      return last;
    }
    sleep(500);
  }
  throw new Error(`PM2 app ${name} did not become online. Last state=${JSON.stringify(last)}`);
}

function removeConflicts(name, scriptPath, scriptArgs = []) {
  const apps = readApps();
  const plan = buildPlan(apps, name, scriptPath, scriptArgs);
  for (const id of plan.deleteIds) {
    const r = runPm2(["delete", String(id)], true);
    if (r.code !== 0) throw new Error(`Unable to delete conflicting PM2 app id=${id}: ${r.stderr || r.stdout}`);
  }
  return readApps();
}

function reconcile(name, scriptArg, scriptArgs = []) {
  const scriptPath = path.resolve(ROOT, scriptArg);
  const desiredArgs = normalizeArgs(scriptArgs);
  let apps = removeConflicts(name, scriptPath, desiredArgs);
  const named = apps.find(app => String(app.name) === String(name)) || null;

  if (named && appPath(named) === normalizePath(scriptPath) && argsEqual(named.pm2_env?.args, desiredArgs)) {
    const r = runPm2(["restart", name, "--update-env"], true);
    if (r.code !== 0) throw new Error(`Unable to restart ${name}: ${r.stderr || r.stdout}`);
  } else {
    const startArgs = ["start", scriptPath, "--name", name, "--update-env"];
    if (desiredArgs.length) startArgs.push("--", ...desiredArgs);
    let r = runPm2(startArgs, true);
    if (r.code !== 0 && /already launched/i.test(`${r.stdout}\n${r.stderr}`)) {
      apps = readApps();
      const same = apps.filter(app => appPath(app) === normalizePath(scriptPath));
      for (const app of same) {
        const del = runPm2(["delete", String(app.pm_id)], true);
        if (del.code !== 0) throw new Error(`Unable to remove stale script registration id=${app.pm_id}`);
      }
      r = runPm2(startArgs, true);
    }
    if (r.code !== 0) {
      throw new Error(`Unable to create canonical PM2 app ${name}: ${r.stderr || r.stdout}`.trim());
    }
  }

  const online = waitForOnline(name, scriptPath);
  const finalApps = readApps();
  const duplicates = finalApps.filter(app => appPath(app) === normalizePath(scriptPath) && String(app.name) !== String(name));
  if (duplicates.length) {
    throw new Error(`Duplicate PM2 registrations remain for ${scriptPath}: ${duplicates.map(x => `${x.name}#${x.pm_id}`).join(", ")}`);
  }

  const result = {
    ok: true,
    name,
    pid: Number(online.pid || 0),
    status: online.pm2_env?.status || null,
    script: online.pm2_env?.pm_exec_path || null,
    pmId: online.pm_id,
    args: normalizeArgs(online.pm2_env?.args)
  };
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  const [name, scriptArg, ...scriptArgs] = process.argv.slice(2);
  if (!name || !scriptArg) {
    console.error("Usage: node SCRIPTS/ReconcilePm2Process.js <name> <scriptPath> [script args...]");
    process.exit(2);
  }
  try {
    reconcile(name, scriptArg, scriptArgs);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { normalizePath, appPath, normalizeArgs, argsEqual, buildPlan, reconcile };
