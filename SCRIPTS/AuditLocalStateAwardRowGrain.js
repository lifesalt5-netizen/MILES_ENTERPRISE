"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function norm(v) { return String(v == null ? "" : v).trim(); }
function numeric(v) {
  const s = norm(v).replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function sampleCsv(file, limit) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  const rows = [];
  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
      continue;
    }
    if (!line.trim()) continue;
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    rows.push(row);
    if (rows.length >= limit) break;
  }
  rl.close();
  stream.destroy();
  return { headers: headers || [], rows };
}

function keyStats(rows, fields) {
  const seen = new Set();
  let blank = 0;
  let dup = 0;
  for (const row of rows) {
    const parts = fields.map((f) => norm(row[f]));
    if (parts.every((x) => !x)) { blank++; continue; }
    const key = parts.join("||").toUpperCase();
    if (seen.has(key)) dup++;
    else seen.add(key);
  }
  return {
    fields,
    sampledRows: rows.length,
    blankKeys: blank,
    distinctKeys: seen.size,
    duplicateRowsWithinSample: dup,
    uniquenessRate: rows.length ? Number((seen.size / rows.length).toFixed(6)) : 0
  };
}

function amountStats(rows, field) {
  const nums = rows.map((r) => numeric(r[field])).filter((x) => x != null);
  return {
    field,
    populated: nums.length,
    zeroCount: nums.filter((x) => x === 0).length,
    min: nums.length ? Math.min(...nums) : null,
    max: nums.length ? Math.max(...nums) : null,
    sumSampleOnly: nums.reduce((a, b) => a + b, 0),
    authorizedForAggregation: false
  };
}

function chooseFiles(family, inspectionSources, maxFiles) {
  const paths = [...new Set((family.paths || []).concat(
    inspectionSources.filter((s) => s.familyKey === family.familyKey).map((s) => s.path)
  ))].filter((p) => p && fs.existsSync(p));
  if (paths.length <= maxFiles) return paths;
  const picks = [];
  const indexes = [0, Math.floor(paths.length * .25), Math.floor(paths.length * .5), Math.floor(paths.length * .75), paths.length - 1];
  for (const i of indexes) if (paths[i] && !picks.includes(paths[i])) picks.push(paths[i]);
  for (const p of paths) {
    if (picks.length >= maxFiles) break;
    if (!picks.includes(p)) picks.push(p);
  }
  return picks;
}

(async () => {
  const manifestPath = path.resolve(arg("--manifest"));
  const inspectionPath = path.resolve(arg("--inspection"));
  const mappingPath = path.resolve(arg("--mapping"));
  const outputArg = arg("--output", null);
  const sampleRowsPerFile = Number(arg("--sample-rows-per-file", "500"));
  const maxTxFiles = Number(arg("--max-tx-files", "12"));

  for (const [label, file] of [["manifest", manifestPath], ["inspection", inspectionPath], ["mapping", mappingPath]]) {
    if (!file || !fs.existsSync(file)) throw new Error(`--${label} must point to an existing JSON file`);
  }

  const manifest = loadJson(manifestPath);
  const inspection = loadJson(inspectionPath);
  const mapping = loadJson(mappingPath);
  if (!mapping.ok) throw new Error("Schema mapping must pass before row-grain audit");

  const families = (manifest.manifest || []).filter((x) => x.disposition === "INCLUDE" && x.sourceType === "STATE_AWARD");
  const results = [];
  const warnings = [];
  const errors = [];

  for (const family of families) {
    const state = (family.states || [])[0] || "UNKNOWN";
    const files = chooseFiles(family, inspection.sources || [], state === "TX" ? maxTxFiles : 3);
    const sampled = [];
    const perFile = [];

    for (const file of files) {
      const s = await sampleCsv(file, sampleRowsPerFile);
      perFile.push({ path: file, sampledRows: s.rows.length, headers: s.headers });
      for (const row of s.rows) sampled.push({ ...row, __source_file: file });
    }

    if (state === "TX") {
      const keyCandidates = [
        ["sales_fact_number"],
        ["invoice_number"],
        ["po_number"],
        ["contract_number", "invoice_number"],
        ["vendor_name", "contract_number", "invoice_number", "purchase_amount", "order_date"],
        ["customer_name", "vendor_name", "contract_number", "po_number", "invoice_number", "purchase_amount", "order_date"]
      ];
      const stats = keyCandidates.map((k) => keyStats(sampled, k));
      const best = stats.slice().sort((a, b) => b.uniquenessRate - a.uniquenessRate)[0] || null;
      const overlapAcrossFiles = new Map();
      for (const row of sampled) {
        const key = norm(row.sales_fact_number) || [norm(row.vendor_name), norm(row.contract_number), norm(row.invoice_number), norm(row.purchase_amount), norm(row.order_date)].join("||");
        if (!key.replace(/\|/g, "")) continue;
        if (!overlapAcrossFiles.has(key)) overlapAcrossFiles.set(key, new Set());
        overlapAcrossFiles.get(key).add(row.__source_file);
      }
      const crossFileOverlapKeys = [...overlapAcrossFiles.values()].filter((set) => set.size > 1).length;
      const amount = amountStats(sampled, "purchase_amount");
      const result = {
        state,
        familyKey: family.familyKey,
        filesInFamily: family.files,
        filesSampled: files.length,
        rowsSampled: sampled.length,
        grainInterpretation: "SALES_OR_PURCHASE_TRANSACTION_GRAIN",
        contractIdentifier: "contract_number",
        realizedRevenueCandidate: "purchase_amount",
        awardedValueCandidate: null,
        keyCandidates: stats,
        bestSampleKeyCandidate: best,
        crossFileOverlapKeysInSample: crossFileOverlapKeys,
        amountStats: amount,
        governingDecision: {
          purchaseAmountMeaning: "REALIZED_SLED_SALES_CANDIDATE_NOT_CONTRACT_AWARDED_VALUE",
          awardCountFromRowsAuthorized: false,
          realizedRevenueAggregationAuthorized: false,
          reason: "Exact cross-file deduplication key must be validated across the full 215-file family before aggregation."
        }
      };
      if (crossFileOverlapKeys > 0) warnings.push({ state, warning: "CROSS_FILE_OVERLAP_OBSERVED_IN_SAMPLE", count: crossFileOverlapKeys });
      if (!best || best.uniquenessRate < 0.999) warnings.push({ state, warning: "NO_NEAR_UNIQUE_TRANSACTION_KEY_IN_SAMPLE" });
      results.push(result);
    } else if (state === "CA") {
      const keyCandidates = [
        ["Purchase Document #"],
        ["Supplier ID", "Purchase Document #"],
        ["Supplier ID", "LPA Contract ID", "Purchase Document #"],
        ["Department", "Supplier ID", "Purchase Document #", "Version"]
      ];
      const stats = keyCandidates.map((k) => keyStats(sampled, k));
      const grandTotal = amountStats(sampled, "Grand Total");
      const result = {
        state,
        familyKey: family.familyKey,
        filesInFamily: family.files,
        filesSampled: files.length,
        rowsSampled: sampled.length,
        grainInterpretation: "PURCHASE_DOCUMENT_OR_CONTRACT_RECORD_GRAIN",
        supplierIdentifier: "Supplier ID",
        supplierName: "Supplier Name",
        purchaseDocumentIdentifier: "Purchase Document #",
        contractIdentifierCandidate: "LPA Contract ID",
        amountCandidate: "Grand Total",
        keyCandidates: stats,
        amountStats: grandTotal,
        governingDecision: {
          grandTotalMeaning: "DOCUMENT_TOTAL_CANDIDATE_REQUIRES_SOURCE_SEMANTIC_VALIDATION",
          distinctAwardCountAuthorized: false,
          awardedValueAggregationAuthorized: false,
          reason: "Need to confirm whether Grand Total is authoritative purchase-document value and whether multiple versions/associated POs duplicate the same underlying award."
        }
      };
      if (!grandTotal.populated) warnings.push({ state, warning: "GRAND_TOTAL_NOT_POPULATED_IN_SAMPLE" });
      results.push(result);
    } else {
      errors.push({ state, error: "UNEXPECTED_STATE_IN_LOCAL_AWARD_AUDIT" });
    }
  }

  const result = {
    ok: errors.length === 0,
    service: "LOCAL_STATE_AWARD_ROW_GRAIN_AUDIT",
    mode: "READ_ONLY_SAMPLED_AUDIT",
    generatedAt: new Date().toISOString(),
    sampleRowsPerFile,
    familyCount: results.length,
    results,
    warningCount: warnings.length,
    errorCount: errors.length,
    warnings,
    errors,
    normalizationAuthorized: false,
    aggregationAuthorized: false,
    orionWritesPerformed: false,
    sourceFilesChanged: false
  };

  if (outputArg) {
    const output = path.resolve(outputArg);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    result.output = output;
  }

  console.log(JSON.stringify({
    ok: result.ok,
    service: result.service,
    familyCount: result.familyCount,
    warningCount: result.warningCount,
    errorCount: result.errorCount,
    tx: result.results.find((x) => x.state === "TX") ? {
      filesSampled: result.results.find((x) => x.state === "TX").filesSampled,
      rowsSampled: result.results.find((x) => x.state === "TX").rowsSampled,
      crossFileOverlapKeysInSample: result.results.find((x) => x.state === "TX").crossFileOverlapKeysInSample,
      bestSampleKeyCandidate: result.results.find((x) => x.state === "TX").bestSampleKeyCandidate
    } : null,
    ca: result.results.find((x) => x.state === "CA") ? {
      rowsSampled: result.results.find((x) => x.state === "CA").rowsSampled,
      grandTotal: result.results.find((x) => x.state === "CA").amountStats,
      keyCandidates: result.results.find((x) => x.state === "CA").keyCandidates
    } : null,
    output: result.output || null
  }, null, 2));
  console.log(`LOCAL_STATE_AWARD_ROW_GRAIN_AUDIT_STATUS=${result.ok ? "PASS" : "BLOCKED"}`);
})().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
