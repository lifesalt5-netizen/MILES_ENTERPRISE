"use strict";

const fs = require("fs");
const path = require("path");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const registryPath = path.resolve(arg("--registry", path.join(process.cwd(), "CONFIG", "StateProcurementAcquisitionRegistry.json")));
const manifestPath = arg("--manifest", null);
const outputPath = arg("--output", null);

if (!fs.existsSync(registryPath)) throw new Error(`Registry missing: ${registryPath}`);
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8").replace(/^\uFEFF/, ""));
let manifest = null;
if (manifestPath && fs.existsSync(path.resolve(manifestPath))) {
  manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8").replace(/^\uFEFF/, ""));
}

const covered = new Set((manifest?.statesCovered || registry.governingRules?.existingLocalAwardCoverage || []).map(String));
const jurisdictions = (registry.jurisdictions || []).map((j) => {
  const awardLocal = covered.has(j.code);
  return {
    code: j.code,
    awardDataLocal: awardLocal,
    awardSourceAction: awardLocal ? "VALIDATE_AND_NORMALIZE_LOCAL_AWARD_SOURCE" : "DISCOVER_AUTHORITATIVE_AWARD_SOURCE",
    vendorRegistryAction: "DISCOVER_AUTHORITATIVE_VENDOR_REGISTRY",
    acquisitionStatus: awardLocal ? "PARTIAL_COVERAGE" : "SOURCE_DISCOVERY_REQUIRED",
    requiredOutputs: [
      "vendor_identity_source",
      "award_source",
      "download_or_api_method",
      "refresh_cadence",
      "vendor_name_field",
      "vendor_id_or_uei_field",
      "email_field_if_public",
      "award_id_field",
      "award_amount_field",
      "award_date_field",
      "agency_field"
    ]
  };
});

const result = {
  ok: true,
  service: "STATE_PROCUREMENT_ACQUISITION_PLAN",
  generatedAt: new Date().toISOString(),
  jurisdictionCount: jurisdictions.length,
  awardCoveredCount: jurisdictions.filter((j) => j.awardDataLocal).length,
  remainingAwardJurisdictions: jurisdictions.filter((j) => !j.awardDataLocal).length,
  vendorRegistryDiscoveryRequiredCount: jurisdictions.length,
  governingRules: registry.governingRules,
  jurisdictions,
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
  jurisdictionCount: result.jurisdictionCount,
  awardCoveredCount: result.awardCoveredCount,
  remainingAwardJurisdictions: result.remainingAwardJurisdictions,
  vendorRegistryDiscoveryRequiredCount: result.vendorRegistryDiscoveryRequiredCount,
  coveredAwardStates: jurisdictions.filter((j) => j.awardDataLocal).map((j) => j.code),
  output: result.output || null
}, null, 2));
console.log("STATE_PROCUREMENT_ACQUISITION_PLAN_STATUS=COMPLETE");
