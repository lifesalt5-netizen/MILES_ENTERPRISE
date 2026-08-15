"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const target = path.join(ROOT, "SERVICES", "RevenueMissionSourceService.js");

if (!fs.existsSync(target)) {
  throw new Error(`Missing target: ${target}`);
}

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${target}.BEFORE_CANONICAL_REVENUE_TRUTH_V2_${stamp}`;
fs.copyFileSync(target, backup);

let src = fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "");

function findMethodRange(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const brace = source.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0;
  let inS = false, inD = false, inT = false, esc = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (!inD && !inT && ch === "'") inS = !inS;
    else if (!inS && !inT && ch === '"') inD = !inD;
    else if (!inS && !inD && ch === '`') inT = !inT;
    if (inS || inD || inT) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

const readRange = findMethodRange(src, "  readCandidates() {");
if (!readRange) {
  fs.copyFileSync(backup, target);
  throw new Error("Could not locate readCandidates() structurally. Original restored.");
}

const methods = `  isSyntheticOrJunkDeal(item = {}) {
    const text = [
      item.id,
      item.name,
      item.company,
      item.contactName,
      item.email,
      item.source
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return /build[ _-]?e010|test company|example\\.com|unknown target/.test(text);
  }

  readLatestSalesPipelineReview() {
    const dir = path.join(this.rootDir, "DATA", "sales_coo");
    try {
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir)
        .filter(name => /^pipeline_review_.*\\.json$/i.test(name))
        .map(name => {
          const file = path.join(dir, name);
          return { file, mtimeMs: fs.statSync(file).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (!files.length) return null;
      return { file: files[0].file, data: readJson(files[0].file, null) };
    } catch {
      return null;
    }
  }

  readCandidates() {
    const candidates = [];
    const sourceSummary = [];

    const dealsFile = path.join(this.rootDir, "DATA", "runtime", "latest_deals.json");
    const dealsRaw = readJson(dealsFile, {});
    const deals = Array.isArray(dealsRaw && dealsRaw.deals) ? dealsRaw.deals : [];
    let canonicalDeals = 0;

    for (let i = 0; i < deals.length; i++) {
      const deal = deals[i] || {};
      if (this.isSyntheticOrJunkDeal(deal)) continue;
      if (String(deal.status || "ACTIVE").toUpperCase() !== "ACTIVE") continue;
      canonicalDeals++;
      candidates.push(this.normalizeItem({
        ...deal,
        title: deal.company || deal.name || "Active revenue deal",
        objective: deal.action || ("Advance active deal: " + (deal.company || deal.name || deal.id)),
        revenueStage: deal.stage || "PIPELINE",
        expectedRevenue: Number(deal.value || 0),
        executionConfidence: Math.round(Number(deal.probability || 0) * 100),
        urgency: String(deal.urgency || "").toLowerCase() === "high" ? 95 : String(deal.urgency || "").toLowerCase() === "medium" ? 80 : 60,
        customerImpact: 90,
        strategicValue: 95
      }, "latest_deals", dealsFile, i));
    }
    sourceSummary.push({ source: "latest_deals", file: dealsFile, found: canonicalDeals, rawFound: deals.length });

    const sales = this.readLatestSalesPipelineReview();
    let salesRecommendations = 0;
    if (sales && sales.data) {
      const outputs = Array.isArray(sales.data.analysis && sales.data.analysis.outputs) ? sales.data.analysis.outputs : [];
      const recommendations = Array.isArray(sales.data.recommendations) ? sales.data.recommendations : [];
      const realDealIds = new Set();
      for (const row of outputs) {
        const deal = row && row.deal ? row.deal : {};
        if (this.isSyntheticOrJunkDeal(deal)) continue;
        if (deal.id) realDealIds.add(String(deal.id));
      }
      for (let i = 0; i < recommendations.length; i++) {
        const rec = recommendations[i] || {};
        if (rec.dealId && realDealIds.size && !realDealIds.has(String(rec.dealId))) continue;
        const text = [rec.dealName, rec.reason, rec.action].filter(Boolean).join(" ");
        if (this.isSyntheticOrJunkDeal({ name: text })) continue;
        salesRecommendations++;
        candidates.push(this.normalizeItem({
          ...rec,
          id: "SALES_RECOMMENDATION_" + (rec.dealId || i) + "_" + (rec.action || "ACTION"),
          title: (rec.action || "SALES_ACTION") + ": " + (rec.dealName || rec.dealId || "Revenue deal"),
          objective: rec.reason || ("Execute " + (rec.action || "sales action") + " for " + (rec.dealName || rec.dealId || "active deal") + "."),
          revenueStage: /close/i.test(String(rec.action || "")) ? "NEGOTIATION" : "PIPELINE",
          urgency: /close/i.test(String(rec.action || "")) ? 100 : 85,
          strategicValue: 95,
          executionConfidence: 90,
          requiresKevin: rec.protected === true
        }, "sales_coo_pipeline", sales.file, i));
      }
      sourceSummary.push({ source: "sales_coo_pipeline", file: sales.file, found: salesRecommendations });
    } else {
      sourceSummary.push({ source: "sales_coo_pipeline", file: null, found: 0 });
    }

    const orionFile = path.join(this.rootDir, "DATA", "orion_coo", "latest_orion_operation.json");
    const orion = readJson(orionFile, {});
    const intel = orion && orion.intelligence ? orion.intelligence : {};
    const recs = Array.isArray(intel.recommendationRecords) ? intel.recommendationRecords : [];
    const opps = Array.isArray(intel.opportunities) ? intel.opportunities : [];
    const recompetes = Array.isArray(intel.recompetes) ? intel.recompetes : [];

    let orionAdded = 0;
    for (let i = 0; i < opps.length && orionAdded < 5; i++) {
      const opp = opps[i] || {};
      const title = String(opp.title || "").trim();
      if (!title || /^not applicable$/i.test(title)) continue;
      candidates.push(this.normalizeItem({
        ...opp,
        id: "ORION_OPP_" + (opp.id || i),
        title,
        objective: "Review ORION opportunity for fit and capture action: " + title,
        revenueStage: "PIPELINE",
        urgency: opp.due_date ? 80 : 60,
        strategicValue: 80,
        executionConfidence: 60
      }, "orion_opportunity", orionFile, i));
      orionAdded++;
    }

    let recompeteAdded = 0;
    for (let i = 0; i < recompetes.length && recompeteAdded < 5; i++) {
      const rec = recompetes[i] || {};
      const title = String(rec.title || "").trim();
      if (!title) continue;
      candidates.push(this.normalizeItem({
        ...rec,
        id: "ORION_RECOMPETE_" + (rec.id || i),
        title,
        objective: "Assess recompete/capture relevance: " + title,
        revenueStage: "PIPELINE",
        urgency: rec.recompete_date ? 75 : 50,
        strategicValue: 75,
        executionConfidence: 50
      }, "orion_recompete", orionFile, i));
      recompeteAdded++;
    }

    sourceSummary.push({
      source: "orion_growth_intelligence",
      file: orionFile,
      found: orionAdded + recompeteAdded,
      opportunitiesAvailable: opps.length,
      recompetesAvailable: recompetes.length,
      recommendationRecordsAvailable: recs.length
    });

    for (const definition of this.sourceFiles) {
      const raw = readJson(definition.file, []);
      const items = this.extractItems(raw);
      sourceSummary.push({ source: definition.source, file: definition.file, found: items.length });
      items.forEach((item, index) => {
        candidates.push(this.normalizeItem(item, definition.source, definition.file, index));
      });
    }

    const seen = new Set();
    const deduped = [];
    for (const item of candidates) {
      const key = [item.id || "", item.source || "", item.company || item.client || "", item.title || ""].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    return { candidates: deduped, sourceSummary };
  }`;

src = src.slice(0, readRange.start) + methods + src.slice(readRange.end);

fs.writeFileSync(target, src, "utf8");

console.log("=== CANONICAL REVENUE TRUTH WIRING P0 V2 ===");
console.log("patched:", target);
console.log("backup :", backup);
console.log("change : structural replacement of readCandidates() with canonical deal + Sales COO + bounded ORION truth wiring");
console.log("next   : node --check .\\SERVICES\\RevenueMissionSourceService.js");
