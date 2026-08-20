"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(ROOT, "DATA", "runtime", "runtime_generations");
const POLL_MS = Math.max(250, Number(process.env.MILES_RUNTIME_GENERATION_POLL_MS || 1000));
const GRACE_MS = Math.max(1000, Number(process.env.MILES_RUNTIME_SHUTDOWN_GRACE_MS || 8000));

function parseArgs(argv) {
  const result = { args: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--runtime") result.runtime = argv[++i];
    else if (value === "--entry") result.entry = argv[++i];
    else if (value === "--arg") result.args.push(argv[++i]);
    else result.args.push(value);
  }
  if (!result.runtime || !result.entry) {
    throw new Error("Usage: RuntimeGenerationGuard.js --runtime <name> --entry <file> [--arg <value>]");
  }
  return result;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(temp, file); }
  catch {
    fs.copyFileSync(temp, file);
    try { fs.unlinkSync(temp); } catch {}
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function killTree(pid, force = false) {
  if (!pid) return;
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(pid, force ? "SIGKILL" : "SIGTERM"); } catch {}
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entry = path.isAbsolute(options.entry) ? options.entry : path.join(ROOT, options.entry);
  if (!fs.existsSync(entry)) throw new Error(`Runtime entry missing: ${entry}`);

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const leaseFile = path.join(RUNTIME_DIR, `${options.runtime}.json`);
  const generation = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const startedAt = new Date().toISOString();

  writeJsonAtomic(leaseFile, {
    runtime: options.runtime,
    generation,
    guardPid: process.pid,
    entry,
    startedAt,
    heartbeatAt: startedAt
  });

  const child = spawn(process.execPath, [entry, ...options.args], {
    cwd: ROOT,
    env: {
      ...process.env,
      MILES_ROOT: ROOT,
      MILES_RUNTIME_NAME: options.runtime,
      MILES_RUNTIME_GENERATION: generation,
      MILES_RUNTIME_GUARD_PID: String(process.pid)
    },
    stdio: "inherit",
    windowsHide: true
  });

  let stopping = false;
  let poll = null;
  let hardStop = null;

  const ownsLease = () => readJson(leaseFile)?.generation === generation;

  const stop = (reason, code = 0) => {
    if (stopping) return;
    stopping = true;
    if (poll) clearInterval(poll);
    console.log(`[MILES RUNTIME GUARD] ${options.runtime} stopping: ${reason}`);

    try { child.kill("SIGTERM"); } catch {}
    if (process.platform === "win32") killTree(child.pid, false);

    hardStop = setTimeout(() => {
      killTree(child.pid, true);
      process.exit(code);
    }, GRACE_MS);
    hardStop.unref?.();
  };

  poll = setInterval(() => {
    if (!ownsLease()) {
      stop("generation superseded", 0);
      return;
    }
    writeJsonAtomic(leaseFile, {
      runtime: options.runtime,
      generation,
      guardPid: process.pid,
      childPid: child.pid,
      entry,
      startedAt,
      heartbeatAt: new Date().toISOString()
    });
  }, POLL_MS);

  process.once("SIGINT", () => stop("SIGINT", 0));
  process.once("SIGTERM", () => stop("SIGTERM", 0));

  child.once("error", error => {
    console.error(`[MILES RUNTIME GUARD] ${options.runtime} child error:`, error.stack || error.message);
    stop("child error", 1);
  });

  child.once("exit", (code, signal) => {
    if (poll) clearInterval(poll);
    if (hardStop) clearTimeout(hardStop);
    if (ownsLease()) {
      try { fs.rmSync(leaseFile, { force: true }); } catch {}
    }
    console.log(`[MILES RUNTIME GUARD] ${options.runtime} child exited code=${code} signal=${signal || "none"}`);
    process.exit(Number.isInteger(code) ? code : (stopping ? 0 : 1));
  });

  console.log(`[MILES RUNTIME GUARD] ${options.runtime} generation=${generation} guardPid=${process.pid} childPid=${child.pid}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error("[MILES RUNTIME GUARD] fatal:", error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, writeJsonAtomic, readJson, killTree, main };
