"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, ".."));
const COMPANY = String(process.env.MILES_ACCEPTANCE_COMPANY || "").trim();
const OUT_DIR = path.join(ROOT, "DATA", "operational_acceptance");

function requestJson(port, route, method = "GET", body = null, timeoutMs = 15000) {
  return new Promise(resolve => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      timeout: timeoutMs,
      headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, json, text });
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, statusCode: 0, error: "TIMEOUT" }); });
    req.on("error", error => resolve({ ok: false, statusCode: 0, error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

function requestText(port, route, timeoutMs = 10000) {
  return new Promise(resolve => {
    const req = http.get({ hostname: "127.0.0.1", port, path: route, timeout: timeoutMs }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, text }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, statusCode: 0, error: "TIMEOUT", text: "" }); });
    req.on("error", error => resolve({ ok: false, statusCode: 0, error: error.message, text: "" }));
  });
}

function push(results, name, pass, details = {}) {
  results.push({ name, status: pass ? "GREEN" : "RED", ...details });
  console.log(`${name}: ${pass ? "GREEN" : "RED"}${details.reason ? ` - ${details.reason}` : ""}`);
}

function discoverCompanyFromOrion() {
  try {
    const connector = require(path.join(ROOT, "CONNECTORS", "ORION", "connector"));
    const init = connector.initialize();
    if (!init?.ok) return null;
    const rows = connector.query("SELECT company, uei FROM contractors WHERE company IS NOT NULL AND TRIM(company) <> '' ORDER BY COALESCE(federal_revenue,0) DESC LIMIT 1");
    return rows?.[0]?.uei || rows?.[0]?.company || null;
  } catch {
    return null;
  }
}

async function main() {
  const results = [];
  console.log("============================================================");
  console.log("MILES FULL PRODUCT FUNCTIONAL ACCEPTANCE - LIVE / READ ONLY");
  console.log("============================================================");

  const dashboard = await requestText(8737, "/");
  push(results, "executive_dashboard_route", dashboard.ok && /MILES Executive Dashboard|P2GC/i.test(dashboard.text), { statusCode: dashboard.statusCode });

  const commandUi = await requestText(8787, "/");
  push(results, "miles_execution_route", commandUi.ok && /Miles Command Center/i.test(commandUi.text), { statusCode: commandUi.statusCode });

  const commandHealth = await requestJson(8787, "/api/health");
  push(results, "miles_execution_health", commandHealth.ok && commandHealth.json?.service === "MILES_COMMAND_CENTER", { statusCode: commandHealth.statusCode, backendStatus: commandHealth.json?.status || null });

  const readOnlyCommand = await requestJson(8787, "/api/command", "POST", {
    command: "Review current P2GC revenue operations read-only. Do not send, create, update, modify, activate, pause, delete, publish, submit, or write anything."
  });
  const commandAccepted = readOnlyCommand.ok && readOnlyCommand.json?.ok === true && Boolean(readOnlyCommand.json?.operation?.id || readOnlyCommand.json?.operationId);
  push(results, "miles_execution_command_to_queue", commandAccepted, {
    statusCode: readOnlyCommand.statusCode,
    backendStatus: readOnlyCommand.json?.status || null,
    operationId: readOnlyCommand.json?.operation?.id || readOnlyCommand.json?.operationId || null,
    failure: readOnlyCommand.json || readOnlyCommand.error || null
  });

  const demoHealth = await requestJson(8791, "/api/health");
  push(results, "prospect_demo_health", demoHealth.ok && demoHealth.json?.ok !== false, { statusCode: demoHealth.statusCode, backendStatus: demoHealth.json?.status || null });

  const deliveryHealth = await requestJson(8792, "/api/health");
  push(results, "customer_revenue_operations_health", deliveryHealth.ok && deliveryHealth.json?.ok !== false, { statusCode: deliveryHealth.statusCode, backendStatus: deliveryHealth.json?.status || null });

  const revenue = await requestJson(8792, "/api/revenue");
  push(results, "customer_revenue_operations_result", revenue.ok && revenue.json && typeof revenue.json === "object", { statusCode: revenue.statusCode, backendStatus: revenue.json?.status || null });

  const meetings = await requestJson(8792, "/api/meetings");
  push(results, "meeting_pipeline_result", meetings.ok && meetings.json && typeof meetings.json === "object", { statusCode: meetings.statusCode, backendStatus: meetings.json?.status || null });

  const company = COMPANY || discoverCompanyFromOrion();
  push(results, "representative_company_available", Boolean(company), { company: company || null });

  if (company) {
    try {
      const ExecutiveGrowthBlueprintDemoService = require(path.join(ROOT, "SERVICES", "demo", "ExecutiveGrowthBlueprintDemoService"));
      const P2GCFocusedIntelligenceService = require(path.join(ROOT, "SERVICES", "demo", "P2GCFocusedIntelligenceService"));
      const P2GCPrimeSubTeamingService = require(path.join(ROOT, "SERVICES", "teaming", "P2GCPrimeSubTeamingService"));
      const blueprintService = new ExecutiveGrowthBlueprintDemoService();
      const model = blueprintService.build(company);
      const identityOk = model?.ok === true && Boolean(model.profile?.companyName) && Boolean(model.evidence || model.safety);
      push(results, "live_prospect_demo_semantic_result", identityOk, { company: model?.profile?.companyName || company, backendStatus: model?.status || null });

      const focused = new P2GCFocusedIntelligenceService();
      for (const type of ["opportunities", "vehicles", "recompetes"]) {
        const result = focused.build(type, model);
        const truthful = result?.ok === true && result.type === type && result.prospect?.companyName === model.profile?.companyName && typeof result.disclosure === "string";
        push(results, `${type}_semantic_result`, truthful, { backendStatus: result?.status || null, recordCount: Array.isArray(result?.records) ? result.records.length : null });
      }

      const teaming = new P2GCPrimeSubTeamingService({ blueprintService });
      const teamResult = teaming.build(company);
      const teamOk = teamResult?.ok === true && teamResult.prospect?.companyName === model.profile?.companyName && teamResult.safety?.contactsInvented === false;
      push(results, "sub2prime_semantic_result", teamOk, { backendStatus: teamResult?.status || null, primeCandidates: teamResult?.primeCandidates?.length || 0 });
    } catch (error) {
      push(results, "product_semantic_execution", false, { reason: error.message });
    }
  }

  try {
    const CaptureCapacityProspectDiscoveryService = require(path.join(ROOT, "SERVICES", "revenue", "CaptureCapacityProspectDiscoveryService"));
    const service = new CaptureCapacityProspectDiscoveryService({ rootDir: ROOT });
    const discovery = service.discover({ writeReport: false, maxAudience: 2000 });
    const structured = discovery && discovery.service === "CAPTURE_CAPACITY_PROSPECT_DISCOVERY" && discovery.sourceCounts && Array.isArray(discovery.candidates);
    push(results, "capture_capacity_discovery_entrypoint", structured, {
      qualifiedRows: discovery?.sourceCounts?.qualifiedRows ?? null,
      contactRows: discovery?.sourceCounts?.contactRows ?? null,
      signalRows: discovery?.sourceCounts?.signalRows ?? null,
      nextAction: discovery?.nextAction || null
    });
  } catch (error) {
    push(results, "capture_capacity_discovery_entrypoint", false, { reason: error.message });
  }

  const semanticTest = spawnSync(process.execPath, [path.join(ROOT, "TESTS", "full_product_functional_acceptance_test.js")], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  push(results, "semantic_regression_suite", semanticTest.status === 0 && /FULL_PRODUCT_FUNCTIONAL_ACCEPTANCE_TEST: GREEN/.test(semanticTest.stdout || ""), {
    exitCode: semanticTest.status,
    stderr: semanticTest.status === 0 ? null : String(semanticTest.stderr || "").slice(-4000)
  });

  const passed = results.every(item => item.status === "GREEN");
  const report = {
    ok: passed,
    status: passed ? "FULL_PRODUCT_FUNCTIONAL_ACCEPTANCE_GREEN" : "FULL_PRODUCT_FUNCTIONAL_ACCEPTANCE_RED",
    readOnly: true,
    company: company || null,
    results,
    generatedAt: new Date().toISOString()
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "latest_full_product_functional_acceptance.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  console.log(`Report: ${file}`);
  console.log(`RESULT: ${passed ? "GREEN - FULL PRODUCT FUNCTIONAL ACCEPTANCE" : "RED - FULL PRODUCT FUNCTIONAL ACCEPTANCE"}`);
  process.exitCode = passed ? 0 : 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
