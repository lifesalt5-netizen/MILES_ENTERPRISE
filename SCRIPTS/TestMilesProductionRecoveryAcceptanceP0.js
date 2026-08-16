"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { runPm2, parsePm2Jlist } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "runtime_guardian");
const REPORT = path.join(OUT_DIR, "production_recovery_acceptance_latest.json");
const TASK_QUEUE_FILE = path.join(ROOT, "DATA", "runtime", "task_queue.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
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
      .filter(x => x.value && x.mtimeMs >= sinceMs - 1000)
      .sort((a,b)=>b.mtimeMs-a.mtimeMs);
  } catch { return []; }
}
function matchesExecution(record, taskId, operationId) {
  const v = record.value || {};
  const text = JSON.stringify(v);
  const directTask = taskId && String(v.taskId || v.id || "") === String(taskId);
  const taskMention = taskId && text.includes(String(taskId));
  const opMention = operationId && text.includes(String(operationId));
  return Boolean(directTask || taskMention || opMention);
}
function taskQueueExecution(taskId) {
  if (!taskId) return null;
  const queue = readJson(TASK_QUEUE_FILE, []);
  if (!Array.isArray(queue)) return null;
  const task = queue.find(item => String(item?.id || "") === String(taskId));
  if (!task) return null;
  const status = String(task.status || "").toUpperCase();
  const terminal = ["COMPLETED","FAILED","BLOCKED","AWAITING_APPROVAL","AWAITING_CEO_APPROVAL","CANCELLED"].includes(status);
  if (!terminal && !task.result) return null;
  return {
    value: {
      taskId: task.id,
      ok: status === "COMPLETED" && task.result?.ok !== false,
      status,
      result: task.result || null,
      provider: task.provider || task.payload?.provider || null,
      action: task.action || task.payload?.action || task.type || null,
      error: task.error || task.failure || null,
      persistedIn: "TaskQueue"
    },
    file: `${TASK_QUEUE_FILE}#${task.id}`
  };
}
function successfulExecutionResult(value) {
  if (!value || typeof value !== "object") return false;
  const status = String(value.status || value.result?.status || value.workforceResult?.status || value.result?.workforceResult?.status || "").toUpperCase();
  if (["FAILED","ERROR","BLOCKED","AWAITING_APPROVAL","AWAITING_CEO_APPROVAL","CANCELLED","COMPLETED_WITH_ERRORS"].includes(status)) return false;
  const flags = [
    value.ok,
    value.result?.ok,
    value.workforceResult?.ok,
    value.result?.workforceResult?.ok
  ].filter(v => typeof v === "boolean");
  return status === "COMPLETED" && flags.includes(true) && !flags.includes(false);
}
function pm2State(name) {
  try {
    const apps = parsePm2Jlist(runPm2(["jlist"]).stdout);
    const app = apps.find(item => item.name === name);
    return app ? {
      name,
      pid:Number(app.pid || 0),
      status:app?.pm2_env?.status || null,
      restarts:Number(app?.pm2_env?.restart_time || 0),
      memoryMB:Math.round(Number(app?.monit?.memory || 0)/1024/1024)
    } : null;
  } catch { return null; }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive:true });
  const checks = [];
  const add = (name, ok, detail = null) => {
    checks.push({ name, ok:Boolean(ok), detail });
    console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` :: ${detail}` : ""}`);
  };

  const workerBefore = pm2State("miles-worker");
  add("worker online before acceptance", workerBefore?.status === "online" && workerBefore.pid > 0, workerBefore ? `pid=${workerBefore.pid} restarts=${workerBefore.restarts}` : "missing");

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
    add("internal demo truth endpoint reachable", demo.statusCode === 200 && demo.body?.ok === true, `http=${demo.statusCode}`);
  } catch (e) { add("internal demo truth endpoint reachable", false, e.message); }

  const dealsState = readJson(path.join(ROOT,"DATA","runtime","latest_deals.json"), {});
  const deals = Array.isArray(dealsState?.deals) ? dealsState.deals : [];
  const realDeals = deals.filter(d => !synthetic(d));
  add("canonical deal filtering excludes synthetic records", realDeals.length < deals.length || deals.length === 0, `raw=${deals.length} real=${realDeals.length}`);

  let operationId = null;
  let taskId = null;
  const commandText = "Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems.";
  const commandAcceptedAt = Date.now();

  try {
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
    for (let i=0;i<60;i++) {
      if (fs.existsSync(exact)) {
        const exactValue = readJson(exact,null);
        if (exactValue && matchesExecution({value:exactValue}, taskId, operationId)) {
          persisted = exactValue;
          persistedFile = exact;
          break;
        }
      }

      const candidates = resultFilesSince(commandAcceptedAt).filter(r => matchesExecution(r, taskId, operationId));
      if (candidates.length) {
        persisted = candidates[0].value;
        persistedFile = candidates[0].file;
        break;
      }

      const queueResult = taskQueueExecution(taskId);
      if (queueResult) {
        persisted = queueResult.value;
        persistedFile = queueResult.file;
        break;
      }

      await sleep(2000);
    }
    add("worker persisted current command result", Boolean(persisted), persistedFile || `${TASK_QUEUE_FILE}#${taskId}`);
    const persistedSucceeded = successfulExecutionResult(persisted);
    add("persisted command result succeeded", persistedSucceeded, persisted ? `status=${persisted.status || persisted.result?.status || "unknown"} ok=${persisted.ok}` : "no persisted result");
    if (persisted && !persistedSucceeded) {
      console.log("=== LIVE MISSION FAILURE EVIDENCE ===");
      console.log(JSON.stringify(persisted, null, 2));
      console.log("=== END LIVE MISSION FAILURE EVIDENCE ===");
    }
    if (persisted) {
      const text = JSON.stringify(persisted).toLowerCase();
      add("result excludes synthetic deal names", !/build e010 test company|unknown target|build-e010-test@example\.com/.test(text));
    } else {
      add("result excludes synthetic deal names", false, "No persisted result");
    }
  } else {
    add("worker persisted current command result", false, "No taskId returned");
    add("persisted command result succeeded", false, "No taskId returned");
    add("result excludes synthetic deal names", false, "No result");
  }

  if (operationId) {
    try {
      let op = null;
      for (let i=0;i<30;i++) {
        const r = await requestJson("GET", `/api/operation?id=${encodeURIComponent(operationId)}`);
        op = r.body;
        const s = String(op?.status || "").toUpperCase();
        if (["COMPLETED","AWAITING_VERIFICATION","FAILED","ERROR","BLOCKED","AWAITING_APPROVAL"].includes(s) || op?.latestTask?.result || op?.result) break;
        await sleep(2000);
      }
      const opStatus = String(op?.status || "").toUpperCase();
      const opResult = op?.latestTask?.result || op?.result || null;
      const opOk = Boolean(
        op && opStatus === "COMPLETED" && opResult && opResult?.ok !== false
      );
      add("8787 operation polling returns successful execution truth", opOk, `status=${op?.status || "unknown"}`);
      if (!opOk && op) {
        console.log("=== OPERATION FAILURE EVIDENCE ===");
        console.log(JSON.stringify(op, null, 2));
        console.log("=== END OPERATION FAILURE EVIDENCE ===");
      }
    } catch (e) { add("8787 operation polling returns successful execution truth", false, e.message); }
  } else {
    add("8787 operation polling returns successful execution truth", false, "No operationId returned");
  }

  await sleep(5000);
  const workerAfter = pm2State("miles-worker");
  add("worker remains online after execution", workerAfter?.status === "online" && workerAfter.pid > 0, workerAfter ? `pid=${workerAfter.pid} restarts=${workerAfter.restarts}` : "missing");
  if (workerBefore && workerAfter) {
    add("worker has no restart churn during acceptance", workerAfter.restarts === workerBefore.restarts && workerAfter.pid === workerBefore.pid, `before=${workerBefore.restarts}/${workerBefore.pid} after=${workerAfter.restarts}/${workerAfter.pid}`);
  } else {
    add("worker has no restart churn during acceptance", false, "worker state unavailable");
  }

  const workerStatus = readJson(path.join(ROOT,"DATA","runtime","worker_runtime_status.json"), {});
  add("worker runtime status exists", Boolean(workerStatus && Object.keys(workerStatus).length), workerStatus?.generatedAt || workerStatus?.status || null);
  add("worker runtime lifecycle started", workerStatus?.lifecycle?.started === true && workerStatus?.lifecycle?.shuttingDown !== true, JSON.stringify(workerStatus?.lifecycle || {}));

  const dedicatedMemoryFile = path.join(ROOT,"DATA","runtime_guardian","worker_memory_latest.json");
  const dedicatedMemory = readJson(dedicatedMemoryFile,null);
  const runtimeMemory = workerStatus?.memory && Number.isFinite(Number(workerStatus.memory.rssMb))
    ? {
        ...workerStatus.memory,
        hardMb: Number(process.env.MILES_WORKER_MEMORY_FAIL_MB || 3072),
        source: "worker_runtime_status.json"
      }
    : null;
  const memory = dedicatedMemory || runtimeMemory;
  add("worker RAM telemetry exists", Boolean(memory && Number.isFinite(Number(memory.rssMb))), dedicatedMemory ? dedicatedMemoryFile : runtimeMemory ? "DATA/runtime/worker_runtime_status.json#memory" : "missing");
  if (memory) {
    add("worker RAM below hard limit", Number(memory.rssMb) < Number(memory.hardMb || 3072), `rss=${memory.rssMb}MB hard=${memory.hardMb || 3072}MB`);
  }

  const report = {
    ok: checks.every(c => c.ok),
    generatedAt:new Date().toISOString(),
    operationId,
    taskId,
    persistedFile,
    workerBefore,
    workerAfter,
    memory,
    checks
  };
  fs.writeFileSync(REPORT, JSON.stringify(report,null,2), "utf8");
  console.log(`=== ACCEPTANCE ${report.ok ? "PASS" : "FAIL"} ===`);
  console.log(`report: ${REPORT}`);
  process.exitCode = report.ok ? 0 : 1;
})().catch(error => {
  const report = { ok:false, generatedAt:new Date().toISOString(), fatal:error.stack || error.message };
  try {
    fs.mkdirSync(OUT_DIR,{recursive:true});
    fs.writeFileSync(REPORT,JSON.stringify(report,null,2),"utf8");
  } catch {}
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
