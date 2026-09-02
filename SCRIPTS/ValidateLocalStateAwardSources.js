"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) throw new Error(`Missing required file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function fingerprintFile(file) {
  const stat = fs.statSync(file);
  return {
    path: file,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    fingerprint: crypto.createHash("sha256")
      .update(`${file}|${stat.size}|${stat.mtimeMs}`)
      .digest("hex")
  };
}

const manifestPath = arg("--manifest");
const inspectionPath = arg("--inspection");
const outputPath = arg("--output");

if (!manifestPath || !inspectionPath) {
  throw new Error("Usage: node ValidateLocalStateAwardSources.js --manifest <STATE_SOURCE_MANIFEST.json> --inspection <STATE_SOURCE_SCHEMA_INSPECTION.json> [--output <json>]");
}

const manifestDoc = readJson(manifestPath);
const inspectionDoc = readJson(inspectionPath);
const includedAwards = (manifestDoc.manifest || []).filter(
  (x) => x.disposition === "INCLUDE" && x.sourceType === "STATE_AWARD"
);
const inspectionSources = Array.isArray(inspectionDoc.sources) ? inspectionDoc.sources : [];

const allowedLocalStates = new Set(["CA", "TX"]);
const errors = [];
const warnings = [];
const families = [];

for (const family of includedAwards) {
  const states = Array.isArray(family.states) ? family.states : [];
  const familySources = inspectionSources.filter((s) => s.familyKey === family.familyKey);
  const paths = Array.isArray(family.paths) ? family.paths : familySources.map((s) => s.path);
  const missingPaths = paths.filter((p) => !fs.existsSync(p));
  const readable = familySources.filter((s) => s.readable !== false);
  const headerSignatures = [...new Set(readable.map((s) => s.headerSignature).filter(Boolean))];
  const fieldSignals = family.fieldSignals || {};

  if (!states.length) errors.push({ familyKey: family.familyKey, error: "STATE_NOT_IDENTIFIED" });
  for (const state of states) {
    if (!allowedLocalStates.has(state)) {
      errors.push({ familyKey: family.familyKey, state, error: "UNEXPECTED_LOCAL_AWARD_STATE" });
    }
  }
  if (missingPaths.length) {
    errors.push({ familyKey: family.familyKey, error: "SOURCE_FILES_MISSING", count: missingPaths.length });
  }
  if (!fieldSignals.company && !fieldSignals.vendorId && !fieldSignals.uei) {
    errors.push({ familyKey: family.familyKey, error: "NO_VENDOR_IDENTITY_SIGNAL" });
  }
  if (!fieldSignals.awardId && !fieldSignals.awardAmount) {
    errors.push({ familyKey: family.familyKey, error: "NO_AWARD_GRAIN_SIGNAL" });
  }
  if (family.likelyChunkFamily && headerSignatures.length > 1) {
    errors.push({ familyKey: family.familyKey, error: "CHUNK_SCHEMA_DRIFT", headerSignatureCount: headerSignatures.length });
  }
  if (family.unreadableFiles > 0) {
    errors.push({ familyKey: family.familyKey, error: "UNREADABLE_SOURCE_FILES", count: family.unreadableFiles });
  }
  if (!fieldSignals.awardId) {
    warnings.push({ familyKey: family.familyKey, warning: "DISTINCT_AWARD_KEY_REQUIRES_SOURCE_SPECIFIC_MAPPING" });
  }
  if (!fieldSignals.awardAmount) {
    warnings.push({ familyKey: family.familyKey, warning: "AWARD_AMOUNT_REQUIRES_SOURCE_SPECIFIC_MAPPING" });
  }

  const fingerprints = paths.filter((p) => fs.existsSync(p)).map(fingerprintFile);
  families.push({
    familyKey: family.familyKey,
    states,
    sourceType: family.sourceType,
    likelyChunkFamily: Boolean(family.likelyChunkFamily),
    files: paths.length,
    totalBytes: fingerprints.reduce((sum, f) => sum + f.sizeBytes, 0),
    headerSignatureCount: headerSignatures.length,
    fieldSignals,
    fingerprints,
    acquisitionStage: errors.some((e) => e.familyKey === family.familyKey)
      ? "BLOCKED"
      : "LOCAL_SOURCE_VALIDATED_PENDING_ROW_GRAIN_MAPPING"
  });
}

const statesCovered = [...new Set(families.flatMap((f) => f.states))].sort();
for (const expected of ["CA", "TX"]) {
  if (!statesCovered.includes(expected)) errors.push({ state: expected, error: "EXPECTED_LOCAL_STATE_AWARD_SOURCE_MISSING" });
}

const result = {
  ok: errors.length === 0,
  service: "LOCAL_STATE_AWARD_SOURCE_VALIDATION",
  mode: "READ_ONLY_SOURCE_VALIDATION",
  generatedAt: new Date().toISOString(),
  governingRules: {
    localAwardStatesExpected: ["CA", "TX"],
    productionOrionWrites: false,
    vendorRegistrationIsNotAwardEvidence: true,
    stateAwardRole: "STATE_PRIME",
    nextRequiredStage: "SOURCE_SPECIFIC_ROW_GRAIN_MAPPING"
  },
  includedAwardFamilyCount: includedAwards.length,
  validatedFamilyCount: families.filter((f) => f.acquisitionStage !== "BLOCKED").length,
  statesCovered,
  families,
  warnings,
  errors,
  writesPerformed: Boolean(outputPath),
  sourceFilesChanged: false,
  orionDatabaseChanged: false
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
  includedAwardFamilyCount: result.includedAwardFamilyCount,
  validatedFamilyCount: result.validatedFamilyCount,
  statesCovered: result.statesCovered,
  warningCount: result.warnings.length,
  errorCount: result.errors.length,
  output: result.output || null
}, null, 2));
console.log(`LOCAL_STATE_AWARD_SOURCE_VALIDATION_STATUS=${result.ok ? "PASS" : "BLOCKED"}`);
