"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "runtime_guardian");
const REPORT = path.join(OUT_DIR, "production_recovery_acceptance_latest.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function requestJson(method, pathname, body = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port: 8787,
      path: pathname,
      method,
      timeout: timeoutMs,
      headers: payload ? { "Content-Type":"application/json", "Content-Length":Buffer.byteLength(payload) } : {}
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(data || "{}") }); }
        catch (e) { reject(new Error(`Non-JSON ${pathname}: ${e.message}`)); }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Timeout ${pathname}`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function synthetic(deal = {}) {
  const text = [deal.id,deal.name,deal.company,deal.contactName,deal.email,deal.source].filter(Boolean).join(" ").toLowerCase();
  return /build[ _-]?e010|test company|example\.com|unknown target/.test(text);
}
function findPersistedResult(taskId, operationId, acceptedAt) {
  const dir = path.join(ROOT,"DATA","workforce_results");
  if (!fs.existsSync(dir)) return null;

  const exact = path.join(dir,`WP_${taskId}.json`);
  if (taskId && fs.existsSync(exact)) {
    const value = readJson(exact, null);
    if (value) return { file: exact, value };
  }

  const candidates = fs.readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .map(name => {
      const file = path.join(dir,name);
      try { return { file, mtimeMs: fs.statSync(file).mtimeMs, value: readJson(file,null) }; }
      catch { return null; }
    })
    .filter(Boolean)
    .filter(x => x.value)
    .sort((a,b) => b.mtimeMs-a.mtimeMs);

  for (const item of candidates) {
    const value = item.value || {};
    const text = JSON.stringify(value);
    if (taskId && (String(value.taskId||"") === String(taskId) || text.includes(String(taskId)))) return item;
    if (operationId && text.includes(String(operationId))) return item;
    if (acceptedAt && item.mtimeMs >= acceptedAt - 2000) {
      const type = String(value.type || value.executionMode || "");
      if (/WORKFORCE|BUSINESS_EXECUTION/i.test(type + " " + text.slice(0,500))) return item;
    }
  }

  return null;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive:true });
  const checks = [];
  const add = (name, ok, detail = null) => { checks.push({ name, ok:Boolean(ok), detail }); console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` :: ${detail}` : ""}`); };

  try {
    const health = await requestJson("GET", "/api/health");
    add("8787 health reachable", health.statusCode < 500 && Boolean(health.body), `http=${health.statusCode}`);
  } catch (e) { add("8787 health reachable", false, e.message); }

  try {
    const dashboard = await requestJson("GET", "/api/dashboard");
    const departments = Array.isArray(dashboard.body?.departments) ? dashboard.body.departments : [];
    add("department dashboard reachable", dashboard.statusCode === 200 && dashboard.body?.ok === true, `departments=${departments.length}`);
    add("all operating departments present", departments.length >= 14, `departments=${departments.length}`);
  } catch (e) {
    add("department dashboard reachable", false, e.message);
    add("all operating departments present", false, e.message);
  }

  try {
    const demo = await requestJson("GET", "/api/demo");
    add("demo truth endpoint reachable", demo.statusCode === 200 && demo.body?.ok === true, `http=${demo.statusCode}`);
  } catch (e) { add("demo truth endpoint reachable", false, e.message); }

  const dealsState = readJson(path.join(ROOT,"DATA","runtime","latest_deals.json"), {});
  const deals = Array.isArray(dealsState?.deals) ? dealsState.deals : [];
  const realDeals = deals.filter(d => !synthetic(d));
  add("canonical deal filtering excludes synthetic records", realDeals.length < deals.length || deals.length === 0, `raw=${deals.length} real=${realDeals.length}`);

  let operationId = null;
  let taskId = null;
  let acceptedAt = null;
  try {
    acceptedAt = Date.now();
    const command = await requestJson("POST", "/api/command", {
      command: "Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems."
    }, 70000);
    operationId = command.body?.operation?.id || command.body?.operationId || null;
    taskId = command.body?.enqueueResult?.taskId || null;
    add("read-only command accepted", command.body?.ok === true, `status=${command.body?.status || ""}`);
    add("command bridged to TaskQueue", command.body?.enqueueResult?.ok === true && command.body?.enqueueResult?.status === "BRIDGE_COMPLETED", `taskId=${taskId || "none"}`);
  } catch (e) {
    add("read-only command accepted", false, e.message);
    add("command bridged to TaskQueue", false, e.message);
  }

  let persisted = null;
  let persistedFile = null;
  if (taskId || operationId) {
    for (let i=0;i<45;i++) {
      const found = findPersistedResult(taskId, operationId, acceptedAt);
      if (found) { persisted = found.value; persistedFile = found.file; break; }
      await sleep(2000);
    }
    add("worker persisted command result", Boolean(persisted), persistedFile || `taskId=${taskId || "none"}`);
    if (persisted) {
      const text = JSON.stringify(persisted).toLowerCase();
      add("result excludes synthetic deal names", !/build e010 test company|unknown target|build-e010-test@example\.com/.test(text));
    }
  } else {
    add("worker persisted command result", false, "No taskId or operationId returned");
    add("result excludes synthetic deal names", false, "No result");
  }

  if (operationId) {
    try {
      let op = null;
      for (let i=0;i<20;i++) {
        const r = await requestJson("GET", `/api/operation?id=${encodeURIComponent(operationId)}`);
        op = r.body;
        const s = String(op?.status || "").toUpperCase();
        if (["COMPLETED","AWAITING_VERIFICATION","FAILED","ERROR"].includes(s) || op?.latestTask?.result || op?.result) break;
        await sleep(2000);
      }
      add("8787 operation polling returns execution truth", Boolean(op && (op.latestTask?.result || op.result || /COMPLETED|AWAITING_VERIFICATION/.test(String(op.status||"")))), `status=${op?.status || "unknown"}`);
    } catch (e) { add("8787 operation polling returns execution truth", false, e.message); }
  } else {
    add("8787 operation polling returns execution truth", false, "No operationId returned");
  }

  const workerStatus = readJson(path.join(ROOT,"DATA","runtime","worker_runtime_status.json"), {});
  add("worker runtime status exists", Boolean(workerStatus && Object.keys(workerStatus).length), workerStatus?.generatedAt || workerStatus?.status || null);

  const memoryFile = path.join(ROOT,"DATA","runtime_guardian","worker_memory_latest.json");
  const memory = readJson(memoryFile, null);
  add("worker RAM telemetry exists", Boolean(memory), memoryFile);
  if (memory) {
    add("worker RAM below hard limit", Number(memory.rssMb || 0) < Number(memory.hardMb || 3072), `rss=${memory.rssMb}MB hard=${memory.hardMb || 3072}MB`);
  }

  const report = {
    ok: checks.every(c => c.ok),
    generatedAt: new Date().toISOString(),
    operationId,
    taskId,
    persistedFile,
    checks
  };
  fs.writeFileSync(REPORT, JSON.stringify(report,null,2), "utf8");
  console.log(`=== ACCEPTANCE ${report.ok ? "PASS" : "FAIL"} ===`);
  console.log(`report: ${REPORT}`);
  process.exitCode = report.ok ? 0 : 1;
})().catch(error => {
  const report = { ok:false, generatedAt:new Date().toISOString(), fatal:error.stack || error.message };
  try { fs.mkdirSync(OUT_DIR,{recursive:true}); fs.writeFileSync(REPORT,JSON.stringify(report,null,2),"utf8"); } catch {}
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
