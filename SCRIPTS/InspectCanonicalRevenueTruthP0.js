"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    let raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch (error) {
    return { __readError: error.message };
  }
}

function newestFile(dir, regex) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(name => regex.test(name))
    .map(name => {
      const file = path.join(dir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.file || null;
}

function cleanDeal(deal = {}) {
  return {
    id: deal.id || null,
    company: deal.company || deal.name || null,
    contactName: deal.contactName || null,
    email: deal.email || null,
    stage: deal.stage || null,
    status: deal.status || null,
    value: deal.value ?? null,
    probability: deal.probability ?? null,
    weightedValue: deal.weightedValue ?? null,
    score: deal.score ?? null,
    urgency: deal.urgency || null,
    source: deal.source || null,
    action: deal.action || null,
    lastActivity: deal.lastActivity || null,
    updatedAt: deal.updatedAt || null
  };
}

function isSyntheticOrJunk(deal = {}) {
  const text = [deal.id, deal.company, deal.name, deal.email, deal.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /build[_ -]?e010|test company|example\.com|unknown target|coo_pipeline/.test(text);
}

console.log("=== CANONICAL REVENUE TRUTH INSPECTION P0 ===");
console.log("root:", ROOT);
console.log("READ_ONLY=true");

const latestDealsFile = path.join(ROOT, "DATA", "runtime", "latest_deals.json");
const latestDeals = readJson(latestDealsFile);
const deals = Array.isArray(latestDeals?.deals) ? latestDeals.deals : [];
const realDeals = deals.filter(d => !isSyntheticOrJunk(d));

console.log("\n=== AUTHORITATIVE DEAL STATE ===");
console.log("file:", latestDealsFile);
console.log("exists:", fs.existsSync(latestDealsFile));
console.log("generatedAt:", latestDeals?.generatedAt || null);
console.log("totalDeals:", deals.length);
console.log("realDealsAfterSyntheticFilter:", realDeals.length);
console.log("filteredSyntheticOrJunk:", deals.length - realDeals.length);
console.log(JSON.stringify(realDeals.map(cleanDeal), null, 2));

const salesDir = path.join(ROOT, "DATA", "sales_coo");
const salesFile = newestFile(salesDir, /^pipeline_review_.*\.json$/i);
const sales = salesFile ? readJson(salesFile) : null;
const outputs = Array.isArray(sales?.analysis?.outputs) ? sales.analysis.outputs : [];
const recs = Array.isArray(sales?.recommendations) ? sales.recommendations : [];

console.log("\n=== LATEST SALES COO PIPELINE REVIEW ===");
console.log("file:", salesFile || "MISSING");
console.log("generatedAt:", sales?.generatedAt || null);
console.log("metrics:", JSON.stringify(sales?.metrics || {}, null, 2));
console.log("outputs:", outputs.length);
console.log("recommendations:", recs.length);
console.log("realOutputDeals:", outputs.filter(o => o?.deal && !isSyntheticOrJunk(o.deal)).length);
console.log(JSON.stringify(outputs.filter(o => o?.deal && !isSyntheticOrJunk(o.deal)).map(o => ({
  deal: cleanDeal(o.deal),
  decision: o.decision || null,
  execution: o.execution || null
})), null, 2));

const orionFile = path.join(ROOT, "DATA", "orion_coo", "latest_orion_operation.json");
const orion = readJson(orionFile);
const intelligence = orion?.intelligence || {};

console.log("\n=== ORION REVENUE-RELEVANT INTELLIGENCE ===");
console.log("file:", orionFile);
console.log("generatedAt:", orion?.generatedAt || null);
for (const key of ["opportunities", "recompetes", "recommendationRecords", "contractors", "buyers"]) {
  const value = intelligence[key];
  console.log(key + ":", Array.isArray(value) ? value.length : (value && typeof value === "object" ? Object.keys(value).length : 0));
}

for (const key of ["opportunities", "recompetes", "recommendationRecords"]) {
  const value = intelligence[key];
  if (Array.isArray(value) && value.length) {
    console.log("\nSAMPLE " + key.toUpperCase() + " (first 3):");
    console.log(JSON.stringify(value.slice(0, 3), null, 2));
  }
}

console.log("\n=== RECOMMENDED CANONICAL PRIORITY ===");
console.log("1. latest_deals.json = current P2GC deal truth");
console.log("2. newest sales_coo pipeline_review = pipeline decisions/recommendations");
console.log("3. latest ORION intelligence = opportunity/recompete growth intelligence, not a substitute for current deals");
console.log("4. exclude synthetic BUILD/test/example.com/Unknown Target records from executive revenue recommendations");
console.log("5. deduplicate sales pipeline records against latest_deals by deal id before ranking");
console.log("No files were modified.");
