"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function collectHeaders(source) {
  const headers = Array.isArray(source.headers) ? source.headers : [];
  return headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));
}

function detectField(headers, candidates) {
  const exact = new Map(headers.map((h) => [h.normalized, h.raw]));
  for (const c of candidates) {
    if (exact.has(c)) return { confidence: "EXACT", header: exact.get(c), normalized: c };
  }
  for (const h of headers) {
    for (const c of candidates) {
      if (h.normalized.includes(c) || c.includes(h.normalized)) {
        return { confidence: "FUZZY", header: h.raw, normalized: h.normalized };
      }
    }
  }
  return { confidence: "NONE", header: null, normalized: null };
}

const FIELD_CANDIDATES = {
  company: ["vendor_name", "supplier_name", "contractor_name", "awardee_name", "business_name", "company", "vendor"],
  vendorId: ["vendor_id", "supplier_id", "vendor_number", "supplier_number", "payee_id"],
  uei: ["uei", "unique_entity_id", "unique_entity_identifier"],
  email: ["email", "vendor_email", "supplier_email", "contact_email"],
  awardId: ["award_id", "contract_id", "contract_number", "purchase_order", "purchase_order_number", "po_number", "agreement_number", "document_number"],
  awardAmount: ["award_amount", "contract_amount", "contract_value", "total_amount", "amount", "sales", "spend", "payment_amount"],
  awardDate: ["award_date", "contract_date", "start_date", "effective_date", "purchase_order_date", "po_date", "date"],
  agency: ["agency", "department", "purchasing_agency", "buyer_agency", "organization", "entity"],
  description: ["description", "contract_description", "item_description", "commodity_description", "scope"],
  state: ["state", "vendor_state", "supplier_state"],
  naics: ["naics", "naics_code"],
  address: ["address", "vendor_address", "supplier_address", "street_address"]
};

function mapFields(headers) {
  const mapped = {};
  for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
    mapped[field] = detectField(headers, candidates);
  }
  return mapped;
}

function classifyAmountSemantics(familyKey, mapped, sources) {
  const text = [familyKey, mapped.awardAmount.header, ...sources.flatMap((s) => s.signals || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/payment|payments/.test(text)) return "PAYMENT_OR_TRANSACTION_AMOUNT";
  if (/sales/.test(text)) return "REPORTED_SALES_AMOUNT";
  if (/spend/.test(text)) return "REPORTED_SPEND_AMOUNT";
  if (/award_amount|contract_amount|contract_value/.test(text.replace(/\s+/g, "_"))) return "AWARD_OR_CONTRACT_AMOUNT_CANDIDATE";
  return mapped.awardAmount.header ? "AMOUNT_FIELD_REQUIRES_SOURCE_SEMANTIC_VALIDATION" : "NO_AMOUNT_FIELD";
}

function grainAssessment(family, mapped, sources) {
  const blockers = [];
  const warnings = [];
  if (!mapped.company.header && !mapped.vendorId.header && !mapped.uei.header) blockers.push("NO_VENDOR_IDENTITY_FIELD");
  if (!mapped.awardId.header) warnings.push("NO_EXPLICIT_AWARD_OR_CONTRACT_IDENTIFIER");
  if (!mapped.awardAmount.header) warnings.push("NO_EXPLICIT_AMOUNT_FIELD");
  if (family.likelyChunkFamily && (family.headerSignatureCount || 0) > 1) blockers.push("CHUNK_FAMILY_MULTIPLE_HEADER_SIGNATURES");
  if (family.likelyChunkFamily) warnings.push("CHUNK_OVERLAP_AUDIT_REQUIRED_BEFORE_AGGREGATION");
  const amountSemantics = classifyAmountSemantics(family.familyKey, mapped, sources);
  if (["PAYMENT_OR_TRANSACTION_AMOUNT", "REPORTED_SALES_AMOUNT", "REPORTED_SPEND_AMOUNT"].includes(amountSemantics)) {
    warnings.push("AMOUNT_IS_NOT_YET_AUTHORIZED_AS_AWARDED_REVENUE");
  }
  return {
    blockers,
    warnings,
    amountSemantics,
    rowGrainStatus: blockers.length ? "BLOCKED" : (mapped.awardId.header ? "CANDIDATE_AWARD_OR_CONTRACT_GRAIN" : "TRANSACTION_OR_UNKNOWN_GRAIN_REVIEW_REQUIRED")
  };
}

const manifestPath = path.resolve(arg("--manifest"));
const inspectionPath = path.resolve(arg("--inspection"));
const validationPath = path.resolve(arg("--validation"));
const outputArg = arg("--output", null);

for (const [label, file] of [["manifest", manifestPath], ["inspection", inspectionPath], ["validation", validationPath]]) {
  if (!file || !fs.existsSync(file)) throw new Error(`--${label} must point to an existing JSON file`);
}

const manifest = loadJson(manifestPath);
const inspection = loadJson(inspectionPath);
const validation = loadJson(validationPath);
if (!validation.ok) throw new Error("Local state award source validation must pass before schema mapping");

const includedFamilies = (manifest.manifest || []).filter((x) => x.disposition === "INCLUDE" && x.sourceType === "STATE_AWARD");
const sourcesByFamily = new Map();
for (const s of inspection.sources || []) {
  if (!sourcesByFamily.has(s.familyKey)) sourcesByFamily.set(s.familyKey, []);
  sourcesByFamily.get(s.familyKey).push(s);
}

const familyMappings = includedFamilies.map((family) => {
  const sources = sourcesByFamily.get(family.familyKey) || [];
  const representative = sources.find((s) => s.readable && Array.isArray(s.headers) && s.headers.length) || null;
  const headers = representative ? collectHeaders(representative) : [];
  const mapped = mapFields(headers);
  const assessment = grainAssessment(family, mapped, sources);
  const filePaths = uniq((family.paths || []).concat(sources.map((s) => s.path)));
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    familyKey: family.familyKey,
    states: family.states || [],
    files: filePaths,
    headers: headers.map((h) => h.raw)
  })).digest("hex");
  return {
    familyKey: family.familyKey,
    states: family.states || [],
    files: family.files || filePaths.length,
    totalBytes: family.totalBytes || 0,
    likelyChunkFamily: Boolean(family.likelyChunkFamily),
    headerSignatureCount: family.headerSignatureCount || 0,
    representativePath: representative?.path || null,
    headers: headers.map((h) => h.raw),
    mappedFields: mapped,
    grainAssessment: assessment,
    fingerprint,
    sourceFilesChanged: false
  };
});

const allStates = uniq(familyMappings.flatMap((x) => x.states)).sort();
const errors = [];
const warnings = [];
for (const fm of familyMappings) {
  for (const b of fm.grainAssessment.blockers) errors.push({ familyKey: fm.familyKey, error: b });
  for (const w of fm.grainAssessment.warnings) warnings.push({ familyKey: fm.familyKey, warning: w });
}

const result = {
  ok: errors.length === 0,
  service: "LOCAL_STATE_AWARD_SOURCE_SCHEMA_MAPPING",
  mode: "READ_ONLY_SOURCE_MAPPING",
  generatedAt: new Date().toISOString(),
  familyCount: familyMappings.length,
  statesCovered: allStates,
  familyMappings,
  warningCount: warnings.length,
  errorCount: errors.length,
  warnings,
  errors,
  normalizationAuthorized: false,
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
  statesCovered: result.statesCovered,
  warningCount: result.warningCount,
  errorCount: result.errorCount,
  output: result.output || null
}, null, 2));
console.log(`LOCAL_STATE_AWARD_SOURCE_SCHEMA_MAPPING_STATUS=${result.ok ? "PASS" : "BLOCKED"}`);
