"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { runPm2, parsePm2Jlist } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const REPORT = path.join(ROOT, "DATA", "runtime_guardian", "final_surface_acceptance_latest.json");
const TASK_QUEUE_FILE = path.join(ROOT, "DATA", "runtime", "task_queue.json");
const checks = [];

function add(name, ok, detail = null) { checks.push({ name, ok: Boolean(ok), detail }); console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`); }
function request(port, pathname = "/", timeoutMs = 20000, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const headers = payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {};
    const req = http.request({ hostname: "127.0.0.1", port, path: pathname, method, timeout: timeoutMs, headers }, res => {
      const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ statusCode: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout http://127.0.0.1:${port}${pathname}`))); req.on("error", reject); if (payload) req.write(payload); req.end();
  });
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function parseJson(text) { try { return JSON.parse(text || "{}"); } catch { return null; } }
function pm2Apps() { try { return parsePm2Jlist(runPm2(["jlist"]).stdout); } catch { return []; } }
function pm2Online(name) { const app = pm2Apps().find(x => x.name === name); return app ? { ok: app.pm2_env?.status === "online" && Number(app.pid || 0) > 0, pid: Number(app.pid || 0), status: app.pm2_env?.status || null, script: app.pm2_env?.pm_exec_path || null } : null; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } }
function resultFilesSince(sinceMs) {
  const dir = path.join(ROOT, "DATA", "workforce_results");
  try {
    return fs.readdirSync(dir)
      .filter(name => name.endsWith(".json"))
      .map(name => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs, value: readJson(file) };
      })
      .filter(x => x.value && x.mtimeMs >= sinceMs - 1000)
      .sort((a,b) => b.mtimeMs - a.mtimeMs);
  } catch { return []; }
}
function matchesTask(value, taskId, operationId) {
  if (!value) return false;
  const text = JSON.stringify(value);
  return Boolean((taskId && (String(value.taskId || value.id || "") === String(taskId) || text.includes(String(taskId)))) || (operationId && text.includes(String(operationId))));
}
function taskQueueExecution(taskId) {
  if (!taskId) return null;
  const queue = readJson(TASK_QUEUE_FILE);
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
      persistedIn: "TaskQueue"
    },
    file: `${TASK_QUEUE_FILE}#${task.id}`
  };
}
function successfulExecutionResult(value) {
  if (!value || typeof value !== "object") return false;
  const status = String(value.status || value.result?.status || value.workforceResult?.status || value.result?.workforceResult?.status || "").toUpperCase();
  if (["FAILED","ERROR","BLOCKED","AWAITING_APPROVAL","AWAITING_CEO_APPROVAL","CANCELLED","COMPLETED_WITH_ERRORS"].includes(status)) return false;
  const flags = [value.ok, value.result?.ok, value.workforceResult?.ok, value.result?.workforceResult?.ok].filter(v => typeof v === "boolean");
  return status === "COMPLETED" && flags.includes(true) && !flags.includes(false);
}

(async () => {
  for (const name of ["miles-api", "miles-worker", "miles-command-center", "miles-executive-dashboard", "miles-desktop-ui", "miles-autonomous-coo", "p2gc-customer-delivery", "p2gc-growth-demo"]) {
    const state = pm2Online(name); add(`PM2 ${name} online`, state?.ok === true, state ? `pid=${state.pid} status=${state.status}` : "missing");
  }

  try { const api = await request(3000, "/"); add("MILES API port 3000 responds", api.statusCode === 200 && /MILES OS is running/i.test(api.text), `http=${api.statusCode}`); } catch (e) { add("MILES API port 3000 responds", false, e.message); }
  try { const health = await request(8787, "/api/health"); const json = parseJson(health.text); add("MILES Command Center health responds", health.statusCode === 200 && json?.ok === true, `http=${health.statusCode} status=${json?.status || ""}`); } catch (e) { add("MILES Command Center health responds", false, e.message); }
  try { const dashboard = await request(8787, "/api/dashboard"); const json = parseJson(dashboard.text); add("MILES operating dashboard responds", dashboard.statusCode === 200 && json?.ok === true, `http=${dashboard.statusCode} departments=${Array.isArray(json?.departments) ? json.departments.length : 0}`); } catch (e) { add("MILES operating dashboard responds", false, e.message); }
  try { const state = await request(8737, "/api/state"); const json = parseJson(state.text); add("CEO Executive Dashboard state responds", state.statusCode === 200 && Boolean(json), `http=${state.statusCode}`); } catch (e) { add("CEO Executive Dashboard state responds", false, e.message); }
  try { const brief = await request(8737, "/api/brief"); const json = parseJson(brief.text); add("CEO revenue brief responds", brief.statusCode === 200 && Boolean(json), `http=${brief.statusCode}`); } catch (e) { add("CEO revenue brief responds", false, e.message); }

  let ceoTaskId = null; let ceoOperationId = null; let ceoPersisted = null; let ceoPersistedFile = null;
  const commandStartedAt = Date.now();
  try {
    const command = await request(8737, "/api/command", 70000, "POST", { command: "Review the current P2GC revenue pipeline and report the single highest-priority action for the CEO. Read-only final acceptance. Do not send email, modify campaigns, or change external systems." });
    const json = parseJson(command.text); ceoOperationId = json?.operation?.id || json?.operationId || null; ceoTaskId = json?.enqueueResult?.taskId || null;
    add("CEO Dashboard accepts a MILES command", command.statusCode === 200 && json?.ok === true && json?.enqueueResult?.ok === true, `http=${command.statusCode} operation=${ceoOperationId || "none"} task=${ceoTaskId || "none"}`);
  } catch (e) { add("CEO Dashboard accepts a MILES command", false, e.message); }

  if (ceoTaskId) {
    const expected = path.join(ROOT, "DATA", "workforce_results", `WP_${ceoTaskId}.json`);
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(expected)) {
        const value = readJson(expected);
        if (matchesTask(value, ceoTaskId, ceoOperationId)) { ceoPersisted = value; ceoPersistedFile = expected; break; }
      }
      const candidates = resultFilesSince(commandStartedAt).filter(x => matchesTask(x.value, ceoTaskId, ceoOperationId));
      if (candidates.length) { ceoPersisted = candidates[0].value; ceoPersistedFile = candidates[0].file; break; }
      const queueResult = taskQueueExecution(ceoTaskId);
      if (queueResult) { ceoPersisted = queueResult.value; ceoPersistedFile = queueResult.file; break; }
      await sleep(2000);
    }
    add("CEO Dashboard command reaches worker and persists result", Boolean(ceoPersisted), ceoPersistedFile || `${TASK_QUEUE_FILE}#${ceoTaskId}`);
    add("CEO Dashboard persisted command result succeeded", successfulExecutionResult(ceoPersisted), ceoPersisted ? `status=${ceoPersisted.status || ceoPersisted.result?.status || "unknown"} ok=${ceoPersisted.ok}` : "no result");
  } else {
    add("CEO Dashboard command reaches worker and persists result", false, "No task id returned");
    add("CEO Dashboard persisted command result succeeded", false, "No task id returned");
  }

  try { const desktop = await request(3737, "/api/status"); const json = parseJson(desktop.text); add("MILES Desktop UI responds", desktop.statusCode === 200 && json?.runtime === "running", `http=${desktop.statusCode} runtime=${json?.runtime || ""}`); } catch (e) { add("MILES Desktop UI responds", false, e.message); }

  try {
    const customer = await request(8792, "/api/health"); const json = parseJson(customer.text);
    add("P2GC customer delivery health responds", customer.statusCode === 200 && json?.ok === true && json?.billing?.externalChargeEnabled === false, `http=${customer.statusCode} status=${json?.status || ""}`);
  } catch (e) { add("P2GC customer delivery health responds", false, e.message); }
  try {
    const revenue = await request(8792, "/api/revenue"); const json = parseJson(revenue.text);
    add("P2GC Revenue Command Center responds", revenue.statusCode === 200 && json?.ok === true && Boolean(json?.metrics), `http=${revenue.statusCode}`);
  } catch (e) { add("P2GC Revenue Command Center responds", false, e.message); }

  try { const demo = await request(8791, "/api/health"); const json = parseJson(demo.text); add("P2GC prospect demo health responds", demo.statusCode === 200 && json?.status === "HEALTHY", `http=${demo.statusCode} status=${json?.status || ""}`); } catch (e) { add("P2GC prospect demo health responds", false, e.message); }

  const prod = readJson(path.join(ROOT, "DATA", "runtime_guardian", "production_recovery_acceptance_latest.json"));
  add("latest command execution acceptance passed", prod?.ok === true, prod?.generatedAt || "missing/failed");
  add("latest command produced persisted execution result", Boolean(prod?.persistedFile), prod?.persistedFile || "missing");
  add("latest command has operation id", Boolean(prod?.operationId), prod?.operationId || "missing");
  add("latest command has task id", Boolean(prod?.taskId), prod?.taskId || "missing");

  const report = { ok: checks.every(x => x.ok), generatedAt: new Date().toISOString(), ceoOperationId, ceoTaskId, ceoPersistedFile, checks };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  console.log(`=== FINAL SURFACE ACCEPTANCE ${report.ok ? "PASS" : "FAIL"} ===`); console.log(`report: ${REPORT}`); process.exitCode = report.ok ? 0 : 1;
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });
