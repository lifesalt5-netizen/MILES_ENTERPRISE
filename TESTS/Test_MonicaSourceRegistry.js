"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const file = path.join(ROOT, "CONFIG", "MONICA", "monica_source_registry.json");
const registry = JSON.parse(fs.readFileSync(file, "utf8"));

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(`[FAIL] ${label}`);
  passed += 1;
  console.log(`[PASS] ${label}`);
}

const allowedDispositions = new Set(["ACTIVATE", "ACTIVATE_AS_EVIDENCE", "TEST", "HOLD", "REJECT"]);
const allowedLanes = new Set([
  "STATE_PROVEN_FEDERAL_READY",
  "SAM_REGISTERED_NO_OR_LOW_FEDERAL_REVENUE",
  "FORMER_GSA_NO_SALES / FAILED_ACTIVATION",
  "FEDERAL_SUB_TO_PRIME_READY",
  "COMMERCIAL_SUCCESS_WITH_GOVERNMENT_ENTRY_INTENT"
]);

check(registry.mode === "DISCOVERY_ONLY", "registry remains discovery-only");
check(registry.activationBlocked === true, "activation remains blocked");
check(registry.outreachBlocked === true, "outreach remains blocked");
check(Array.isArray(registry.sources) && registry.sources.length >= 10, "validated source registry is populated");

const ids = registry.sources.map(source => source.id);
check(new Set(ids).size === ids.length, "source IDs are unique");
check(registry.sources.every(source => allowedDispositions.has(source.disposition)), "all dispositions are governed");
check(registry.sources.every(source => source.automaticOutreachAllowed === false), "no source authorizes automatic outreach");
check(registry.sources.every(source => Array.isArray(source.laneFit) && source.laneFit.length > 0), "every source has lane fit");
check(registry.sources.every(source => source.laneFit.every(lane => allowedLanes.has(lane))), "all lane assignments remain inside approved Phase 1");
check(registry.sources.every(source => Array.isArray(source.federalGapTest) && source.federalGapTest.length > 0), "every source requires a federal-gap test");
check(registry.sources.every(source => typeof source.intentSignal === "string" && source.intentSignal.trim()), "every source records intent evidence");
check(registry.sources.every(source => typeof source.accessClass === "string" && source.accessClass.trim()), "every source records access class");
check(registry.sources.every(source => source.harvestAllowed === true), "registry contains only validated harvest/test candidates");
check(registry.sources.some(source => source.id === "USASPENDING_SUBAWARDS" && source.laneFit.includes("FEDERAL_SUB_TO_PRIME_READY")), "USAspending subawards support sub-to-prime lane");
check(registry.sources.some(source => source.id === "GSA_ELIBRARY_SSQ" && source.laneFit.includes("FORMER_GSA_NO_SALES / FAILED_ACTIVATION")), "GSA evidence supports failed-activation lane");
check(registry.sources.some(source => source.id === "FL_DMS_MFMP" && source.disposition === "ACTIVATE"), "Florida state procurement source is activated for research");
check(registry.sources.some(source => source.id === "AFCEA_EXHIBITORS" && source.disposition === "TEST"), "event exhibitors remain test-only");

console.log(`MONICA_SOURCE_REGISTRY_TEST_PASS ${passed}/${passed}`);
