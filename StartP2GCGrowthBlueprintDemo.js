"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const ExecutiveGrowthBlueprintDemoService = require("./SERVICES/demo/ExecutiveGrowthBlueprintDemoService");
const DemoTruthReconciliationService = require("./SERVICES/demo/DemoTruthReconciliationService");
const DemoCommercialPreviewService = require("./SERVICES/demo/DemoCommercialPreviewService");
const SamQualifiedProspectFallbackService = require("./SERVICES/demo/SamQualifiedProspectFallbackService");
const HistoricalProspectFallbackService = require("./SERVICES/demo/HistoricalProspectFallbackService");
const P2GCFocusedIntelligenceService = require("./SERVICES/demo/P2GCFocusedIntelligenceService");
const P2GCPrimeSubTeamingService = require("./SERVICES/teaming/P2GCPrimeSubTeamingService");
const FederalPathwayScoreIntegratedService = require("./SERVICES/FederalPathwayScoreIntegratedService");
const P2GCProposalCommandService = require("./SERVICES/proposal/P2GCProposalCommandService");

const ROOT = __dirname;
const PORT = Number(process.env.P2GC_GROWTH_DEMO_PORT || 8791);
const PUBLIC = path.join(ROOT, "SERVICES", "demo", "public");
const service = new ExecutiveGrowthBlueprintDemoService();
const truthReconciler = new DemoTruthReconciliationService();
const commercialPreview = new DemoCommercialPreviewService();
const samFallback = new SamQualifiedProspectFallbackService({ rootDir: ROOT });
const historicalFallback = new HistoricalProspectFallbackService({ rootDir: ROOT });
const focused = new P2GCFocusedIntelligenceService();
const teaming = new P2GCPrimeSubTeamingService({ blueprintService:service });
const pathwayScore = new FederalPathwayScoreIntegratedService();
const proposalCommand = new P2GCProposalCommandService();
const cache = new Map();
const TTL = Math.max(1000, Number(process.env.P2GC_GROWTH_DEMO_CACHE_MS || 300000));

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control":"no-store", ...extra });
  res.end(body);
}
function json(res, status, body) { send(res, status, "application/json; charset=utf-8", JSON.stringify(body, null, 2)); }
function safeFile(name) { return path.join(PUBLIC, name); }
function staticFile(res, name, type) {
  const file = safeFile(name);
  if (!fs.existsSync(file)) return send(res, 404, "text/plain; charset=utf-8", "Not found");
  send(res, 200, type, fs.readFileSync(file));
}
function key(term) { return String(term || "").trim().toUpperCase(); }
function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > limitBytes) reject(new Error("REQUEST_TOO_LARGE"));
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("INVALID_JSON")); }
    });
    req.on("error", reject);
  });
}
function getModel(term, refresh = false) {
  const k = key(term);
  if (!refresh && cache.has(k)) {
    const hit = cache.get(k);
    if (Date.now() - hit.at < TTL) return { ...hit.model, cache:{ hit:true, ttlMs:TTL } };
    cache.delete(k);
  }

  let baseModel = service.build(term);
  if (!baseModel?.ok && baseModel?.status === "CONTRACTOR_NOT_FOUND") {
    const fallback = samFallback.build(term);
    if (fallback?.ok) baseModel = fallback;
    else baseModel = historicalFallback.build(term, { samFallback: fallback, orionFailure: baseModel });
  }

  if (baseModel?.ok && baseModel.profile?.uei) {
    const currentSam = samFallback.build(baseModel.profile.uei);
    const resolvedUei = String(baseModel.profile.uei || '').trim().toUpperCase();
    const samUei = String(currentSam?.profile?.uei || '').trim().toUpperCase();
    if (currentSam?.ok === true && resolvedUei && samUei === resolvedUei) {
      baseModel = {
        ...baseModel,
        profile: {
          ...(baseModel.profile || {}),
          cage: baseModel.profile?.cage || currentSam.profile?.cage || null,
          website: baseModel.profile?.website || currentSam.profile?.website || null,
          samStatus: 'ACTIVE'
        },
        currentState: {
          ...(baseModel.currentState || {}),
          samRegistration: true
        },
        evidence: {
          ...(baseModel.evidence || {}),
          currentSamRegistration: currentSam.evidence?.identity || null
        }
      };
    }
  }

  const model = commercialPreview.apply(truthReconciler.reconcile(baseModel));
  if (model?.ok) {
    const aliases = [term, model.profile?.companyName, model.profile?.uei, model.profile?.cage, model.profile?.website].map(key).filter(Boolean);
    const record = { at:Date.now(), model };
    aliases.forEach(alias => cache.set(alias, record));
  }
  return model?.ok ? { ...model, cache:{ hit:false, ttlMs:TTL } } : model;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/demo")) return staticFile(res, "index.html", "text/html; charset=utf-8");
  if (req.method === "GET" && pathname === "/teaming") return staticFile(res, "teaming.html", "text/html; charset=utf-8");
  if (req.method === "GET" && pathname === "/proposal-command") return staticFile(res, "proposal-command.html", "text/html; charset=utf-8");
  if (req.method === "GET" && ["/opportunities","/vehicles","/recompetes"].includes(pathname)) return staticFile(res, "intelligence.html", "text/html; charset=utf-8");
  if (req.method === "GET" && pathname === "/app.js") return staticFile(res, "app.js", "application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/proposal-command.js") return staticFile(res, "proposal-command.js", "application/javascript; charset=utf-8");
  if (req.method === "GET" && pathname === "/styles.css") return staticFile(res, "styles.css", "text/css; charset=utf-8");
  if (req.method === "GET" && pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }

  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, { ok:true, status:"HEALTHY", service:"P2GC_EXECUTIVE_GROWTH_BLUEPRINT_DEMO", capabilities:["executive_growth_blueprint","truth_reconciliation","commercial_preview","sam_qualified_identity_fallback","federal_pathway_score","prime_sub_teaming","opportunity_intelligence","vehicle_intelligence","recompete_intelligence","proposal_command"], port:PORT, checkedAt:new Date().toISOString() });
  }

  if (req.method === "GET" && pathname === "/api/proposal-command/health") return json(res, 200, proposalCommand.healthCheck());
  if (req.method === "POST" && pathname === "/api/proposal-command/run") {
    readJsonBody(req)
      .then(payload => json(res, 200, proposalCommand.run(payload)))
      .catch(error => json(res, error.message === "REQUEST_TOO_LARGE" ? 413 : 400, {ok:false,status:error.message,error:error.message}));
    return;
  }

  if (req.method === "GET" && pathname === "/api/assessment") {
    const term = String(url.searchParams.get("term") || "").trim();
    if (!term) return json(res, 400, { ok:false, status:"TERM_REQUIRED", message:"Enter company name, UEI, CAGE, or website." });
    try {
      const model = getModel(term, url.searchParams.get("refresh") === "1");
      return json(res, model?.ok ? 200 : 404, model);
    } catch (error) {
      return json(res, 500, { ok:false, status:"ASSESSMENT_FAILED", error:error.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/pathway-score") {
    const term = String(url.searchParams.get("term") || "").trim();
    if (!term) return json(res, 400, { ok:false, status:"TERM_REQUIRED", message:"Enter company name or UEI." });
    pathwayScore.evaluate(term)
      .then(result => json(res, result?.ok ? 200 : 404, result))
      .catch(error => json(res, 500, { ok:false, status:"PATHWAY_SCORE_FAILED", error:error.message }));
    return;
  }

  if (req.method === "GET" && pathname === "/api/intelligence") {
    const term = String(url.searchParams.get("term") || "").trim();
    const type = String(url.searchParams.get("type") || "").trim();
    if (!term) return json(res, 400, { ok:false, status:"TERM_REQUIRED", message:"Enter company name, UEI, CAGE, or website." });
    try {
      const model = getModel(term, url.searchParams.get("refresh") === "1");
      if (!model?.ok) return json(res, 404, model);
      const result = focused.build(type, model);
      return json(res, result?.ok ? 200 : 400, result);
    } catch (error) {
      return json(res, 500, { ok:false, status:"FOCUSED_INTELLIGENCE_FAILED", error:error.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/teaming") {
    const term = String(url.searchParams.get("term") || "").trim();
    if (!term) return json(res, 400, { ok:false, status:"TERM_REQUIRED", message:"Enter company name, UEI, CAGE, or website." });
    try {
      const model = getModel(term, url.searchParams.get("refresh") === "1");
      if (!model?.ok) return json(res, 404, model);
      return json(res, 200, teaming.fromBlueprint(model));
    } catch (error) {
      return json(res, 500, { ok:false, status:"TEAMING_INTELLIGENCE_FAILED", error:error.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/blueprint") {
    const term = String(url.searchParams.get("term") || "").trim();
    const format = String(url.searchParams.get("format") || "md").toLowerCase();
    if (!term) return json(res, 400, { ok:false, status:"TERM_REQUIRED" });
    try {
      const model = getModel(term, false);
      if (!model?.ok) return json(res, 404, model);
      const safe = String(model.profile?.companyName || model.profile?.uei || "prospect").replace(/[^a-zA-Z0-9_-]+/g,"_").slice(0,80);
      if (format === "json") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(model, null, 2), { "Content-Disposition":`attachment; filename="P2GC_Growth_Blueprint_${safe}.json"` });
      const markdown = service.toMarkdown(model);
      return send(res, 200, "text/markdown; charset=utf-8", markdown, { "Content-Disposition":`attachment; filename="P2GC_Growth_Blueprint_${safe}.md"` });
    } catch (error) {
      return json(res, 500, { ok:false, status:"BLUEPRINT_EXPORT_FAILED", error:error.message });
    }
  }

  send(res, 404, "text/plain; charset=utf-8", "Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`P2GC Executive Government Growth Blueprint Demo: http://127.0.0.1:${PORT}`);
  console.log(`P2GC Proposal Command: http://127.0.0.1:${PORT}/proposal-command`);
  console.log(`P2GC Federal Pathway Score API: http://127.0.0.1:${PORT}/api/pathway-score?term=<company-or-uei>`);
  console.log(`P2GC Sub2Prime Teaming Intelligence: http://127.0.0.1:${PORT}/teaming`);
  console.log(`P2GC Opportunity Intelligence: http://127.0.0.1:${PORT}/opportunities`);
  console.log(`P2GC Vehicle Intelligence: http://127.0.0.1:${PORT}/vehicles`);
  console.log(`P2GC Recompete Intelligence: http://127.0.0.1:${PORT}/recompetes`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));