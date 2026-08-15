"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const target = path.join(ROOT, "SERVICES", "RevenueMissionSourceService.js");

if (!fs.existsSync(target)) {
  throw new Error(`Missing target: ${target}`);
}

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${target}.BEFORE_CANONICAL_REVENUE_TRUTH_${stamp}`;
fs.copyFileSync(target, backup);

let src = fs.readFileSync(target, "utf8");
const original = src;

function insertBefore(marker, text) {
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error(`Marker not found: ${marker}`);
  src = src.slice(0, idx) + text + src.slice(idx);
}

// Add canonical truth helpers before readCandidates().
insertBefore("  readCandidates() {", `  isSyntheticOrJunkDeal(item = {}) {\n    const text = [\n      item.id,\n      item.name,\n      item.company,\n      item.contactName,\n      item.email,\n      item.source\n    ]\n      .filter(Boolean)\n      .join(" ")\n      .toLowerCase();\n\n    if (/build[ _-]?e010|test company|example\\.com|unknown target/.test(text)) {\n      return true;\n    }\n\n    return false;\n  }\n\n  readLatestSalesPipelineReview() {\n    const dir = path.join(this.rootDir, "DATA", "sales_coo");\n    try {\n      if (!fs.existsSync(dir)) return null;\n      const files = fs.readdirSync(dir)\n        .filter(name => /^pipeline_review_.*\\.json$/i.test(name))\n        .map(name => {\n          const file = path.join(dir, name);\n          return { file, mtimeMs: fs.statSync(file).mtimeMs };\n        })\n        .sort((a, b) => b.mtimeMs - a.mtimeMs);\n      if (!files.length) return null;\n      return { file: files[0].file, data: readJson(files[0].file, null) };\n    } catch {\n      return null;\n    }\n  }\n\n  readCanonicalRevenueTruth() {\n    const candidates = [];\n    const sourceSummary = [];\n\n    const dealsFile = path.join(this.rootDir, "DATA", "runtime", "latest_deals.json");\n    const dealsRaw = readJson(dealsFile, {});\n    const deals = Array.isArray(dealsRaw?.deals) ? dealsRaw.deals : [];\n    let canonicalDeals = 0;\n\n    for (let i = 0; i < deals.length; i++) {\n      const deal = deals[i];\n      if (this.isSyntheticOrJunkDeal(deal)) continue;\n      if (String(deal?.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue;\n      canonicalDeals++;\n      candidates.push(this.normalizeItem({\n        ...deal,\n        title: deal.company || deal.name || "Active revenue deal",\n        objective: deal.action || `Advance active deal: ${deal.company || deal.name || deal.id}`,\n        revenueStage: deal.stage || "PIPELINE",\n        expectedRevenue: Number(deal.value || 0),\n        executionConfidence: Math.round(Number(deal.probability || 0) * 100),\n        urgency: String(deal.urgency || "").toLowerCase() === "high" ? 95 : String(deal.urgency || "").toLowerCase() === "medium" ? 80 : 60,\n        customerImpact: 90,\n        strategicValue: 95,\n        source: "latest_deals"\n      }, "latest_deals", dealsFile, i));\n    }\n    sourceSummary.push({ source: "latest_deals", file: dealsFile, found: canonicalDeals, rawFound: deals.length });\n\n    const sales = this.readLatestSalesPipelineReview();\n    let salesRecommendations = 0;\n    if (sales?.data) {\n      const outputs = Array.isArray(sales.data?.analysis?.outputs) ? sales.data.analysis.outputs : [];\n      const recommendations = Array.isArray(sales.data?.recommendations) ? sales.data.recommendations : [];\n      const realDealIds = new Set();\n      for (const row of outputs) {\n        const deal = row?.deal || {};\n        if (this.isSyntheticOrJunkDeal(deal)) continue;\n        if (deal.id) realDealIds.add(String(deal.id));\n      }\n      for (let i = 0; i < recommendations.length; i++) {\n        const rec = recommendations[i] || {};\n        if (rec.dealId && realDealIds.size && !realDealIds.has(String(rec.dealId))) continue;\n        const text = [rec.dealName, rec.reason, rec.action].filter(Boolean).join(" ");\n        if (this.isSyntheticOrJunkDeal({ name: text })) continue;\n        salesRecommendations++;\n        candidates.push(this.normalizeItem({\n          ...rec,\n          id: `SALES_RECOMMENDATION_${rec.dealId || i}_${rec.action || "ACTION"}`,\n          title: `${rec.action || "SALES_ACTION"}: ${rec.dealName || rec.dealId || "Revenue deal"}`,\n          objective: rec.reason || `Execute ${rec.action || "sales action"} for ${rec.dealName || rec.dealId || "active deal"}.`,\n          revenueStage: /close/i.test(String(rec.action || "")) ? "NEGOTIATION" : "PIPELINE",\n          urgency: /close/i.test(String(rec.action || "")) ? 100 : 85,\n          strategicValue: 95,\n          executionConfidence: 90,\n          requiresKevin: rec.protected === true,\n          source: "sales_coo_pipeline"\n        }, "sales_coo_pipeline", sales.file, i));\n      }\n      sourceSummary.push({ source: "sales_coo_pipeline", file: sales.file, found: salesRecommendations });\n    } else {\n      sourceSummary.push({ source: "sales_coo_pipeline", file: null, found: 0 });\n    }\n\n    const orionFile = path.join(this.rootDir, "DATA", "orion_coo", "latest_orion_operation.json");\n    const orion = readJson(orionFile, {});\n    const recs = Array.isArray(orion?.intelligence?.recommendationRecords) ? orion.intelligence.recommendationRecords : [];\n    const opps = Array.isArray(orion?.intelligence?.opportunities) ? orion.intelligence.opportunities : [];\n    const recompetes = Array.isArray(orion?.intelligence?.recompetes) ? orion.intelligence.recompetes : [];\n\n    // ORION is growth intelligence, not current P2GC deal truth. Surface only a bounded, non-placeholder sample.\n    let orionAdded = 0;\n    for (let i = 0; i < opps.length && orionAdded < 5; i++) {\n      const opp = opps[i] || {};\n      const title = String(opp.title || "").trim();\n      if (!title || /^not applicable$/i.test(title)) continue;\n      candidates.push(this.normalizeItem({\n        ...opp,\n        id: `ORION_OPP_${opp.id || i}`,\n        title,\n        objective: `Review ORION opportunity for fit and capture action: ${title}`,\n        revenueStage: "PIPELINE",\n        urgency: opp.due_date ? 80 : 60,\n        strategicValue: 80,\n        executionConfidence: 60,\n        source: "orion_opportunity"\n      }, "orion_opportunity", orionFile, i));\n      orionAdded++;\n    }\n\n    let recompeteAdded = 0;\n    for (let i = 0; i < recompetes.length && recompeteAdded < 5; i++) {\n      const rec = recompetes[i] || {};\n      const title = String(rec.title || "").trim();\n      if (!title) continue;\n      candidates.push(this.normalizeItem({\n        ...rec,\n        id: `ORION_RECOMPETE_${rec.id || i}`,\n        title,\n        objective: `Assess recompete/capture relevance: ${title}`,\n        revenueStage: "PIPELINE",\n        urgency: rec.recompete_date ? 75 : 50,\n        strategicValue: 75,\n        executionConfidence: 50,\n        source: "orion_recompete"\n      }, "orion_recompete", orionFile, i));\n      recompeteAdded++;\n    }\n\n    sourceSummary.push({\n      source: "orion_growth_intelligence",\n      file: orionFile,\n      found: orionAdded + recompeteAdded,\n      opportunitiesAvailable: opps.length,\n      recompetesAvailable: recompetes.length,\n      recommendationRecordsAvailable: recs.length\n    });\n\n    return { candidates, sourceSummary };\n  }\n\n`);

// Replace readCandidates body structurally by locating method start and class end marker.
const start = src.indexOf("  readCandidates() {");
const endMarker = "\n}\n\nmodule.exports = RevenueMissionSourceService;";
const classEnd = src.lastIndexOf(endMarker);
if (start < 0 || classEnd < 0 || classEnd <= start) {
  fs.copyFileSync(backup, target);
  throw new Error("Could not locate readCandidates/class boundaries; original restored.");
}

const replacement = `  readCandidates() {\n    const canonical = this.readCanonicalRevenueTruth();\n\n    // Legacy configured revenue sources remain additive if they are populated later.\n    const legacyCandidates = [];\n    const legacySummary = [];\n\n    for (const definition of this.sourceFiles) {\n      const raw = readJson(definition.file, []);\n      const items = this.extractItems(raw);\n\n      legacySummary.push({\n        source: definition.source,\n        file: definition.file,\n        found: items.length\n      });\n\n      items.forEach((item, index) => {\n        legacyCandidates.push(\n          this.normalizeItem(\n            item,\n            definition.source,\n            definition.file,\n            index\n          )\n        );\n      });\n    }\n\n    const deduped = new Map();\n    for (const item of [...canonical.candidates, ...legacyCandidates]) {\n      const key = String(item.id || [item.source, item.company, item.title, item.action].join("|")).toLowerCase();\n      if (!deduped.has(key)) deduped.set(key, item);\n    }\n\n    return {\n      candidates: [...deduped.values()],\n      sourceSummary: [...canonical.sourceSummary, ...legacySummary]\n    };\n  }`;

src = src.slice(0, start) + replacement + src.slice(classEnd);

try {
  fs.writeFileSync(target, src, "utf8");
  require("child_process").execFileSync(process.execPath, ["--check", target], { stdio: "inherit" });
} catch (error) {
  fs.copyFileSync(backup, target);
  throw error;
}

console.log("=== CANONICAL REVENUE TRUTH WIRING P0 ===");
console.log(`patched: ${target}`);
console.log(`backup : ${backup}`);
console.log("sources: latest_deals + newest Sales COO pipeline review + bounded ORION growth intelligence + legacy revenue feeds");
console.log("filter : synthetic BUILD/test/example.com/Unknown Target excluded from executive revenue candidates");
console.log("mode   : read-only source wiring; no campaigns/messages/external systems changed");
