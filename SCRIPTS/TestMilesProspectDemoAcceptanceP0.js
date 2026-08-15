"use strict";

const fs = require("fs");
const path = require("path");
const orion = require("../CONNECTORS/ORION/connector");

const ROOT = process.env.MILES_ROOT || process.cwd();
const BASE = process.env.MILES_COMMAND_CENTER_URL || "http://localhost:8787";
const checks = [];

function check(name, ok, detail = null) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}
function normalize(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function synthetic(row = {}) {
  const text = [row.company,row.company_norm,row.uei].filter(Boolean).join(" ").toLowerCase();
  return /build[ _-]?e010|test company|example\.com|unknown target|not applicable/.test(text);
}
function safeKey(value) {
  return String(value || "prospect").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80) || "prospect";
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 120000));
  try {
    const response = await fetch(url, { signal:controller.signal, cache:"no-store" });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status:response.status, ok:response.ok, text, json, headers:response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  const init = orion.initialize();
  check("ORION read-only database available", init?.ok === true, init?.db || init?.message || null);
  if (!init?.ok) throw new Error("ORION unavailable for live demo acceptance.");

  const contractors = orion.getContractors(500, 0).filter(row => row && !synthetic(row) && row.company && row.uei);
  const preferredNames = ["SERA BRYNN", "K K CONSTRUCTION SUPPLY INC", "K & K CONSTRUCTION SUPPLY INC"];
  const selected = preferredNames
    .map(name => contractors.find(row => normalize(row.company) === normalize(name)))
    .find(Boolean) || contractors[0];

  check("real ORION contractor selected", Boolean(selected), selected ? `${selected.company} | ${selected.uei}` : "none");
  if (!selected) throw new Error("No real contractor with company + UEI found in ORION.");

  const page = await request(`${BASE}/demo`, { timeoutMs:15000 });
  check("prospect demo page reachable", page.status === 200 && /Government Growth Intelligence Demo/i.test(page.text), `http=${page.status}`);
  check("demo page has company/UEI input", /companyTerm/.test(page.text), null);

  const landing = await request(`${BASE}/api/demo`, { timeoutMs:15000 });
  check("demo API landing reachable", landing.status === 200 && landing.json?.ok === true, `http=${landing.status} status=${landing.json?.status || ""}`);

  const term = selected.uei || selected.company;
  const encoded = encodeURIComponent(term);
  const first = await request(`${BASE}/api/demo?company=${encoded}&refresh=1`);
  const truth = first.json || {};
  check("real prospect demo request succeeds", first.status === 200 && truth.ok === true, `http=${first.status} status=${truth.status || ""}`);
  check("resolved company is real", Boolean(truth.identity?.name) && !synthetic({company:truth.identity?.name,uei:truth.identity?.uei}), truth.identity?.name || null);
  check("resolved UEI matches selected contractor", normalize(truth.identity?.uei) === normalize(selected.uei), truth.identity?.uei || null);
  check("identity has evidence source", Boolean(truth.identity?.source && truth.evidence?.orion?.authority), `${truth.identity?.source || ""} / ${truth.evidence?.orion?.authority || ""}`);
  check("demo is read-only", truth.readOnly === true && truth.safety?.writesEnabled === false && truth.safety?.externalMutationPerformed === false, null);
  check("availability contract present", ["identity","vehicle","awardHistory","agencyAlignment","opportunities","recompetes","contacts","leadFacts"].every(k => Object.prototype.hasOwnProperty.call(truth.availability || {}, k)), null);

  const serialized = JSON.stringify(truth);
  check("raw ORION company ids are redacted", !serialized.includes("company_id") && !serialized.includes("matchedContractorId"), null);
  check("internal ORION join keys are redacted", !serialized.includes("contractors.id") && !serialized.includes("buyers.company_id"), null);

  if (truth.awardHistory?.available) {
    check("award history has authoritative source", Boolean(truth.awardHistory?.source?.name && truth.awardHistory?.source?.authoritativeLookupPerformed === true), truth.awardHistory?.source?.name || null);
    check("award summary is numeric", Number.isFinite(Number(truth.awardHistory?.summary?.federalRevenue)) && Number.isFinite(Number(truth.awardHistory?.summary?.awardCount)), `revenue=${truth.awardHistory?.summary?.federalRevenue} awards=${truth.awardHistory?.summary?.awardCount}`);
  } else {
    check("unavailable award history is explicit", Boolean(truth.awardHistory?.status) && /UNAVAILABLE|FAILED|NOT_|RECONCILIATION|CONFIRMED/i.test(String(truth.awardHistory.status)), truth.awardHistory?.status || null);
    check("unavailable award history is not fabricated", truth.awardHistory?.summary == null, null);
  }

  const opportunityRows = truth.opportunities?.records || [];
  check("opportunity signals contain no NOT APPLICABLE placeholders", opportunityRows.every(row => normalize(row.title) !== "NOT APPLICABLE"), `records=${opportunityRows.length}`);
  const recompeteRows = truth.recompetes?.records || [];
  check("modeled recompetes remain qualified", recompeteRows.filter(row => row.signalType === "MONITORING_PROFILE").every(row => row.availability === "MODELED_MONITORING_SIGNAL" && /modeled|not a confirmed/i.test(String(row.qualification || ""))), `records=${recompeteRows.length}`);
  check("contact availability is explicit", truth.contacts?.available === true || truth.contacts?.status === "CONTACT_FACTS_UNAVAILABLE", truth.contacts?.status || null);
  check("lead availability is explicit", truth.leadFacts?.available === true || truth.leadFacts?.status === "LEAD_FACTS_UNAVAILABLE", truth.leadFacts?.status || null);
  check("evidence disclosure exists", /Unavailable facts are explicitly marked unavailable/i.test(String(truth.evidence?.disclosure || "")), null);

  const cached = await request(`${BASE}/api/demo?company=${encoded}`);
  check("repeat demo request uses current snapshot cache", cached.status === 200 && cached.json?.cache?.hit === true, `cache=${cached.json?.cache?.hit}`);
  check("cached screen snapshot is same generation", cached.json?.generatedAt === truth.generatedAt, `${truth.generatedAt} -> ${cached.json?.generatedAt}`);

  const formats = [
    ["json","application/json"],
    ["md","text/markdown"],
    ["html","text/html"]
  ];
  for (const [format,type] of formats) {
    const exported = await request(`${BASE}/api/demo/export?company=${encoded}&format=${format}`);
    check(`${format} export reachable`, exported.status === 200 && String(exported.headers.get("content-type") || "").includes(type), `http=${exported.status}`);
    check(`${format} export contains same company`, exported.text.includes(truth.identity.name) || exported.text.includes(truth.identity.uei), truth.identity.name);
  }

  const refreshed = await request(`${BASE}/api/demo?company=${encoded}&refresh=1`);
  check("explicit refresh rebuilds evidence", refreshed.status === 200 && refreshed.json?.ok === true && refreshed.json?.cache?.hit === false, `cache=${refreshed.json?.cache?.hit}`);
  check("refresh preserves resolved identity", normalize(refreshed.json?.identity?.uei) === normalize(truth.identity?.uei), refreshed.json?.identity?.uei || null);

  const prospectDir = path.join(ROOT, "DATA", "demo_truth", "prospects", safeKey(truth.identity?.uei || truth.identity?.name));
  check("current sanitized JSON report persisted", fs.existsSync(path.join(prospectDir,"latest.json")), path.join(prospectDir,"latest.json"));
  check("current Markdown report persisted", fs.existsSync(path.join(prospectDir,"latest.md")), path.join(prospectDir,"latest.md"));
  check("current HTML report persisted", fs.existsSync(path.join(prospectDir,"latest.html")), path.join(prospectDir,"latest.html"));

  const persisted = fs.existsSync(path.join(prospectDir,"latest.json")) ? fs.readFileSync(path.join(prospectDir,"latest.json"),"utf8") : "";
  check("persisted report contains no internal ids", !persisted.includes("matchedContractorId") && !persisted.includes("company_id") && !persisted.includes("contractors.id"), null);

  const report = {
    ok: checks.every(item => item.ok),
    generatedAt: new Date().toISOString(),
    selectedProspect: { company:selected.company, uei:selected.uei },
    checks
  };
  const outDir = path.join(ROOT,"DATA","runtime_guardian");
  fs.mkdirSync(outDir,{recursive:true});
  const reportFile = path.join(outDir,"prospect_demo_acceptance_latest.json");
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2),"utf8");
  console.log(`=== PROSPECT DEMO ACCEPTANCE ${report.ok ? "PASS" : "FAIL"} ===`);
  console.log("report:", reportFile);
  try { orion.shutdown(); } catch {}
  process.exitCode = report.ok ? 0 : 1;
})().catch(error => {
  console.error(error.stack || error.message);
  try { orion.shutdown(); } catch {}
  process.exit(1);
});
