"use strict";

const instantly = require("../CONNECTORS/INSTANTLY/connector");
const orion = require("../CONNECTORS/ORION/connector");

const checks = [];
function add(name, ok, detail = null) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

(async () => {
  try {
    const health = await instantly.healthCheck();
    add(
      "Instantly API read connectivity",
      health?.ok === true && health?.campaignsReachable === true && health?.accountsReachable === true,
      health?.ok ? `api=${health.apiVersion} dryRun=${health.dryRun} mutationsAllowed=${health.mutationsAllowed}` : (health?.error || "health failed")
    );
    add(
      "Instantly mutations remain governed during acceptance",
      health?.ok === true && (health?.dryRun === true || health?.mutationsAllowed === false),
      `dryRun=${health?.dryRun} mutationsAllowed=${health?.mutationsAllowed}`
    );
  } catch (error) {
    add("Instantly API read connectivity", false, error.message);
    add("Instantly mutations remain governed during acceptance", false, "Instantly health unavailable");
  }

  try {
    const health = orion.healthCheck();
    add("ORION database health", health?.ok === true && Number(health?.tableCount || 0) > 0, health?.message || `tables=${health?.tableCount || 0}`);
    const summary = health?.ok ? orion.getSummary() : null;
    add("ORION contractor intelligence available", summary?.contractors?.ok === true && Number(summary?.contractors?.count || 0) > 0, `contractors=${summary?.contractors?.count || 0}`);
    add("ORION buyer intelligence available", summary?.buyers?.ok === true && Number(summary?.buyers?.count || 0) > 0, `buyers=${summary?.buyers?.count || 0}`);
    add("ORION opportunity intelligence table reachable", summary?.opportunities?.ok === true, `opportunities=${summary?.opportunities?.count || 0}`);
    add("ORION recompete intelligence table reachable", summary?.recompetes?.ok === true, `recompetes=${summary?.recompetes?.count || 0}`);
  } catch (error) {
    add("ORION database health", false, error.message);
    add("ORION contractor intelligence available", false, "ORION health unavailable");
    add("ORION buyer intelligence available", false, "ORION health unavailable");
    add("ORION opportunity intelligence table reachable", false, "ORION health unavailable");
    add("ORION recompete intelligence table reachable", false, "ORION health unavailable");
  } finally {
    try { orion.shutdown(); } catch {}
  }

  const report = { ok: checks.every(x => x.ok), generatedAt: new Date().toISOString(), checks };
  console.log(`=== MILES REVENUE CONNECTOR ACCEPTANCE ${report.ok ? "PASS" : "FAIL"} ===`);
  process.exitCode = report.ok ? 0 : 1;
})().catch(error => {
  console.error(error.stack || error.message);
  try { orion.shutdown(); } catch {}
  process.exit(1);
});
