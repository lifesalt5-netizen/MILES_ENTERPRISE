"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const {
  readPromotionManifest,
  collectClosure
} = require("./TestDashboardPromotionClosureP0");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function normalize(value) { return String(value || "").replace(/\\/g, "/"); }
function ensureParent(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: pathname, timeout: 3000 }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error(`HTTP timeout ${pathname}`)));
    req.on("error", reject);
  });
}

async function waitForHttp(port, pathname, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await httpGet(port, pathname);
      if (response.statusCode === 200) return response;
      lastError = new Error(`HTTP ${response.statusCode} ${pathname}: ${response.body.slice(0, 300)}`);
    } catch (error) { lastError = error; }
    await sleep(250);
  }
  throw lastError || new Error(`Timed out waiting for ${pathname}`);
}

async function main() {
  const manifest = readPromotionManifest();
  const closure = collectClosure(["StartExecutiveDashboard.js", "SERVICES/DashboardServerService.js"]);
  const assets = [
    "SERVICES/ceo_dashboard/public/index.html",
    "SERVICES/ceo_dashboard/public/ceo.js",
    "SERVICES/ceo_dashboard/public/ceo.css"
  ];
  const required = [...new Set([...closure, ...assets])].map(normalize);

  const tempRoot = fs.mkdtempSync(path.join(ROOT, ".dashboard-deploy-sim-"));
  const port = 18737;
  let child = null;
  let stdout = "";
  let stderr = "";

  try {
    // Simulate an older protected checkout: every dashboard runtime file begins stale/broken.
    for (const file of required) {
      const target = path.join(tempRoot, file);
      ensureParent(target);
      if (file.endsWith(".js")) fs.writeFileSync(target, 'throw new Error("STALE_LOCAL_DASHBOARD_FILE");\n', "utf8");
      else fs.writeFileSync(target, "STALE_LOCAL_DASHBOARD_ASSET", "utf8");
    }

    // Apply exactly what the production promotion manifest says it will replace.
    for (const file of required) {
      if (!manifest.has(file)) continue;
      const source = path.join(ROOT, file);
      const target = path.join(tempRoot, file);
      ensureParent(target);
      fs.copyFileSync(source, target);
    }

    const env = {
      ...process.env,
      MILES_ROOT: tempRoot,
      MILES_DASHBOARD_PORT: String(port),
      MILES_COMMAND_CENTER_PORT: "18787",
      P2GC_CUSTOMER_DATA_DIR: path.join(tempRoot, "DATA", "customer_delivery"),
      P2GC_GROWTH_DATA_DIR: path.join(tempRoot, "DATA", "growth_assets")
    };

    child = spawn(process.execPath, [path.join(tempRoot, "StartExecutiveDashboard.js")], {
      cwd: tempRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });

    const state = await waitForHttp(port, "/api/state");
    const home = await waitForHttp(port, "/");
    const parsedState = JSON.parse(state.body.replace(/^\uFEFF/, ""));
    if (!parsedState || parsedState.ok !== true) throw new Error("Dashboard state contract did not return ok=true.");
    if (!/MILES/i.test(home.body)) throw new Error("CEO Dashboard home asset did not render MILES content.");

    console.log(JSON.stringify({
      ok: true,
      test: "DASHBOARD_DEPLOYMENT_SIMULATION_P0",
      staleFilesRepaired: required.length,
      stateHttp: state.statusCode,
      homeHttp: home.statusCode,
      node: process.version
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      test: "DASHBOARD_DEPLOYMENT_SIMULATION_P0",
      error: error.message,
      stdout: stdout.slice(-6000),
      stderr: stderr.slice(-6000),
      required
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (child && !child.killed) {
      try { child.kill(); } catch {}
      await sleep(300);
    }
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
