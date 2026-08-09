"use strict";

const fs = require("fs");
const path = require("path");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function federalFalsePositive(row) {
  const text = String(row.familyKey || row.path || "").toLowerCase();
  return /(^|[\\/_ -])(gsa|sam|usaspending|federal|veterans[ _-]?affairs)([\\/_ -]|$)/i.test(text)
    || /gsa[_ -]?va[_ -]?top[_ -]?contractors/i.test(text);
}

function aggregateSignals(sources) {
  const out = {
    company: false, uei: false, email: false, awardId: false, awardAmount: false,
    awardDate: false, agency: false, address: false, naics: false, vendorId: false
  };
  for (const row of sources) {
    for (const key of Object.keys(out)) out[key] = out[key] || Boolean(row.fieldSignals?.[key]);
  }
  return out;
}

function classifyFamily(family, sources) {
  if (federalFalsePositive(family)) {
    return { disposition: "EXCLUDE", reason: "FEDERAL_OR_NON_STATE_FALSE_POSITIVE", sourceType: "NON_STATE" };
  }
  const signals = aggregateSignals(sources);
  const names = sources.flatMap((s) => s.signals || []).map((x) => String(x).toLowerCase());
  const hasAwardSignal = names.some((x) => ["award", "awards", "contract", "contracts", "spend", "purchase", "payments"].includes(x));
  const hasVendorSignal = names.some((x) => ["vendor", "vendors", "supplier"].includes(x));
  const hasAwardSchema = signals.awardId || (signals.awardAmount && (signals.awardDate || signals.agency));
  const hasIdentity = signals.company || signals.vendorId || signals.uei;

  if (hasAwardSignal && hasIdentity && hasAwardSchema) {
    return { disposition: "INCLUDE", reason: "STATE_AWARD_SOURCE", sourceType: "STATE_AWARD" };
  }
  if (hasVendorSignal && hasIdentity) {
    return { disposition: "INCLUDE", reason: "STATE_VENDOR_REGISTRY", sourceType: "STATE_VENDOR" };
  }
  return { disposition: "REVIEW", reason: "INSUFFICIENT_SCHEMA_EVIDENCE", sourceType: "UNKNOWN" };
}

const inspectionPath = path.resolve(arg("--inspection"));
const outputPath = arg("--output", null);
if (!inspectionPath || !fs.existsSync(inspectionPath)) {
  throw new Error("--inspection must point to an existing STATE_SOURCE_SCHEMA_INSPECTION.json file");
}

const inspection = JSON.parse(fs.readFileSync(inspectionPath, "utf8").replace(/^\uFEFF/, ""));
const sources = Array.isArray(inspection.sources) ? inspection.sources : [];
const families = Array.isArray(inspection.families) ? inspection.families : [];
const byFamily = new Map();
for (const row of sources) {
  if (!byFamily.has(row.familyKey)) byFamily.set(row.familyKey, []);
  byFamily.get(row.familyKey).push(row);
}

const manifest = families.map((family) => {
  const familySources = byFamily.get(family.familyKey) || [];
  const classification = classifyFamily(family, familySources);
  const fieldSignals = aggregateSignals(familySources);
  return {
    familyKey: family.familyKey,
    states: family.states || [],
    sourceType: classification.sourceType,
    disposition: classification.disposition,
    reason: classification.reason,
    files: family.files || familySources.length,
    totalBytes: family.totalBytes || 0,
    likelyChunkFamily: Boolean(family.likelyChunkFamily),
    headerSignatureCount: family.headerSignatureCount || 0,
    fieldSignals,
    paths: family.paths || familySources.map((s) => s.path),
    readableFiles: familySources.filter((s) => s.readable).length,
    unreadableFiles: familySources.filter((s) => !s.readable).length
  };
});

const included = manifest.filter((x) => x.disposition === "INCLUDE");
const result = {
  ok: true,
  service: "STATE_SOURCE_MANIFEST",
  mode: "READ_ONLY_SOURCE_ANALYSIS",
  inspectionPath,
  generatedAt: new Date().toISOString(),
  familyCount: manifest.length,
  includedFamilyCount: included.length,
  reviewFamilyCount: manifest.filter((x) => x.disposition === "REVIEW").length,
  excludedFamilyCount: manifest.filter((x) => x.disposition === "EXCLUDE").length,
  stateAwardFamilies: included.filter((x) => x.sourceType === "STATE_AWARD").length,
  stateVendorFamilies: included.filter((x) => x.sourceType === "STATE_VENDOR").length,
  statesCovered: [...new Set(included.flatMap((x) => x.states))].sort(),
  manifest,
  sourceFilesChanged: false,
  writesPerformed: Boolean(outputPath)
};

if (outputPath) {
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(result, null, 2));
  result.output = target;
}

console.log(JSON.stringify({
  ok: result.ok,
  service: result.service,
  familyCount: result.familyCount,
  includedFamilyCount: result.includedFamilyCount,
  reviewFamilyCount: result.reviewFamilyCount,
  excludedFamilyCount: result.excludedFamilyCount,
  stateAwardFamilies: result.stateAwardFamilies,
  stateVendorFamilies: result.stateVendorFamilies,
  statesCovered: result.statesCovered,
  output: result.output || null
}, null, 2));
console.log("STATE_SOURCE_MANIFEST_STATUS=COMPLETE");
