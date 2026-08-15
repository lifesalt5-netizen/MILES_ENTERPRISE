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
      hostname: "127.0.0.1", port: 8787, path: pathname, method, timeout: timeoutMs,
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
function resultFilesSince(sinceMs) {
  const dir = path.join(ROOT,"DATA","workforce_results");
  try {
    return fs.readdirSync(dir)
      .filter(n => n.endsWith(".json"))
      .map(name => {
        const file = path.join(dir,name);
        const stat = fs.statSync(file);
        return { file, name, mtimeMs:stat.mtimeMs, value:readJson(file,null) };
      })
      .filter(x => x.value && x.mtimeMs >= sinceMs - 2000)
      .sort((a,b)=>b.mtimeMs-a.mtimeMs);
  } catch { return []; }
}
function matchesExecution(record, taskId, operationId, command) {
  const v = record.value || {};
  const text = JSON.stringify(v);
  const directTask = String(v.taskId || "") === String(taskId || "");
  const taskMention = taskId && text.includes(String(taskId));
  const opMention = operationId && text.includes(String(operationId));
  const commandMention = command && text.includes(command.slice(0,80));
  return directTask || taskMention || opMention || commandMention;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive:true });
  const checks = [];
  const add = (name, ok, detail = null) => { checks.push({ name, ok:Boolean(ok), detail }); console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` :: ${detail}` : ""}`); };

  try {
    const health = await requestJson("GET", "/api/health");
    add("8787 health reachable", health.statusCode === 200 && health.body?.ok === true, `http=${health.statusCode} status=${health.body?.status || ""}`);
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
  let commandAcceptedAt = Date.now();
  const commandText = "Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems.";
  try {
    commandAcceptedAt = Date.now();
    const command = await requestJson("POST", "/api/command", { command: commandText }, 70000);
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
  if (taskId) {
    const exact = path.join(ROOT,"DATA","workforce_results",`WP_${taskId}.json`);
    for (let i=0;i<45;i++) {
      if (fs.existsSync(exact)) {
        persisted = readJson(exact,null);
        if (persisted) { persistedFile = exact; break; }
      }
      const candidates = resultFilesSince(commandAcceptedAt).filter(r => matchesExecution(r,taskId,operationId,commandText));
      if (candidates.length) {
        persisted = candidates[0].value;
        persistedFile = candidates[0].file;
        break;
      }
      await sleep(2000);
    }
    add("worker persisted command result", Boolean(persisted), persistedFile || exact);
    if (persisted) {
      const text = JSON.stringify(persisted).toLowerCase();
      add("result excludes synthetic deal names", !/build e010 test company|unknown target|build-e010-test@example\.com/.test(text));
    }
  } else {
    add("worker persisted command result", false, "No taskId returned");
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
  const memory = readJson(memoryFile,null);
  add("worker RAM telemetry exists", Boolean(memory), memoryFile);
  if (memory) add("worker RAM below hard limit", Number(memory.rssMb) < Number(memory.hardMb || 3072), `rss=${memory.rssMb}MB hard=${memory.hardMb || 3072}MB`);

  const report = { ok: checks.every(c => c.ok), generatedAt:new Date().toISOString(), operationId, taskId, persistedFile, checks };
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
