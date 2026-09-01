"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const UsaspendingAwardAggregationService = require("../orion/UsaspendingAwardAggregationService");

function clean(value) { return value == null ? "" : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalizeName(value) {
  return clean(value).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function normalizedKey(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function valueByAliases(row, aliases) {
  const lookup = new Map(Object.keys(row || {}).map(key => [normalizedKey(key), row[key]]));
  for (const alias of aliases) {
    const value = lookup.get(normalizedKey(alias));
    if (value !== undefined && clean(value)) return clean(value);
  }
  return "";
}
function parseCsvText(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(values => values.some(value => clean(value)));
}
function csvObjects(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = parseCsvText(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) return [];
  const headers = rows[0].map(clean);
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] == null ? "" : values[index]])));
}
function first(record, aliases) { return valueByAliases(record, aliases); }
function recursivelyListCsv(root) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...recursivelyListCsv(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) out.push(full);
  }
  return out;
}
function classifyCsv(file) { return path.basename(file).toLowerCase().includes("subaward") ? "SUBAWARD" : "PRIME_AWARD"; }
function canonicalIdentity(row, level) {
  const primeUeiAliases = ["recipient_uei", "recipient unique entity identifier", "recipient_unique_entity_identifier", "Recipient UEI"];
  const primeNameAliases = ["recipient_name", "recipient legal business name", "recipient_legal_business_name", "Recipient Name"];
  const subUeiAliases = [
    "sub_recipient_uei", "Sub-Recipient UEI", "subrecipient_uei", "subawardee_uei",
    "subawardee_or_recipient_uei", "sub_awardee_or_recipient_uei", "recipient_uei"
  ];
  const subNameAliases = [
    "Sub-Awardee Name", "subawardee_name", "subrecipient_name", "sub_recipient_name",
    "subawardee_or_recipient_legal_business_name", "sub_awardee_or_recipient_legal_business_name",
    "recipient_name", "Recipient Name"
  ];
  const uei = upper(valueByAliases(row, level === "SUBAWARD" ? subUeiAliases : primeUeiAliases));
  const name = normalizeName(valueByAliases(row, level === "SUBAWARD" ? subNameAliases : primeNameAliases));
  if (uei) return { key: `UEI:${uei}`, uei, name: name || null, authority: "UEI" };
  if (name) return { key: `NAME:${name}`, uei: null, name, authority: "NORMALIZED_LEGAL_NAME_FALLBACK" };
  return null;
}

class AwardedUniverseCoverageService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.awardsRoot = path.join(this.rootDir, "DATA", "staging", "government_data", "usaspending_awards");
    this.outputDir = path.join(this.rootDir, "DATA", "revenue_universe");
    this.reportPath = path.join(this.outputDir, "latest_awarded_universe_coverage.json");
    this.aggregationFactory = options.aggregationFactory || (() => new UsaspendingAwardAggregationService({ rootDir: this.rootDir }));
  }

  resolveMasterFile() {
    let store = {};
    try { store = JSON.parse(fs.readFileSync(path.join(this.rootDir, "DATA", "enterprise_db", "enterprise_store.json"), "utf8")); } catch {}
    const segment = Array.isArray(store?.segments) ? store.segments.find(item => String(item?.id || item?.name || "").toUpperCase() === "MASTER_DEDUPED_ALL_SEGMENTS") : null;
    const candidates = [
      process.env.P2GC_MASTER_FILE,
      segment?.file,
      path.join(this.rootDir, "DATA", "OUTBOUND", "MASTER_DEDUPED_ALL_SEGMENTS.csv"),
      path.join(this.rootDir, "MASTER_DEDUPED_ALL_SEGMENTS.csv")
    ].filter(Boolean);
    return candidates.find(file => fs.existsSync(file)) || null;
  }

  buildMasterIdentityIndex(file) {
    const rows = csvObjects(file);
    const uei = new Set();
    const names = new Set();
    for (const row of rows) {
      const rowUei = upper(first(row, ["uei", "uei_number", "uei sam", "unique_entity_id", "unique entity id"]));
      const rowName = normalizeName(first(row, ["company", "company_name", "legal_business_name", "legal business name", "organization", "vendor_name"]));
      if (rowUei) uei.add(rowUei);
      if (rowName) names.add(rowName);
    }
    return { rows, uei, names };
  }

  findLatestManifest() {
    if (!fs.existsSync(this.awardsRoot)) return null;
    const candidates = [];
    for (const entry of fs.readdirSync(this.awardsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.awardsRoot, entry.name, "manifest.json");
      if (!fs.existsSync(file)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        if (manifest?.ok !== true || manifest?.status !== "COMPLETED") continue;
        const zip = (manifest.artifacts || []).find(item => path.basename(item.filePath || "") === "usaspending_prime_and_subawards.zip")?.filePath;
        if (!zip || !fs.existsSync(zip)) continue;
        const stamp = Date.parse(manifest.generatedAt || "") || fs.statSync(file).mtimeMs;
        candidates.push({ file, manifest, stamp });
      } catch {}
    }
    candidates.sort((a, b) => b.stamp - a.stamp);
    return candidates[0] || null;
  }

  identityInMaster(identity, master) {
    if (!identity) return false;
    if (identity.uei) return master.uei.has(identity.uei);
    return Boolean(identity.name && master.names.has(identity.name));
  }

  async collectIdentitySets(extractedRoot, master) {
    const prime = new Map();
    const sub = new Map();
    const counters = { primeAwardRows: 0, subawardRows: 0, rowsWithoutCanonicalIdentity: 0, primeRowsWithoutCanonicalIdentity: 0, subawardRowsWithoutCanonicalIdentity: 0 };
    const files = recursivelyListCsv(extractedRoot);
    for (const file of files) {
      const level = classifyCsv(file);
      await new Promise((resolve, reject) => {
        fs.createReadStream(file)
          .pipe(csv())
          .on("data", row => {
            if (level === "SUBAWARD") counters.subawardRows += 1;
            else counters.primeAwardRows += 1;
            const identity = canonicalIdentity(row, level);
            if (!identity) {
              counters.rowsWithoutCanonicalIdentity += 1;
              if (level === "SUBAWARD") counters.subawardRowsWithoutCanonicalIdentity += 1;
              else counters.primeRowsWithoutCanonicalIdentity += 1;
              return;
            }
            const target = level === "SUBAWARD" ? sub : prime;
            if (!target.has(identity.key)) target.set(identity.key, { ...identity, inCurrentMaster: this.identityInMaster(identity, master) });
          })
          .on("error", reject)
          .on("end", resolve);
      });
    }
    return { files, prime, sub, counters };
  }

  async run() {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const generatedAt = new Date().toISOString();
    const manifestItem = this.findLatestManifest();
    const masterFile = this.resolveMasterFile();
    if (!manifestItem) {
      const blocked = { ok: false, status: "USASPENDING_PRIME_SUBAWARD_MANIFEST_NOT_AVAILABLE", generatedAt, awardsRoot: this.awardsRoot, masterFile };
      fs.writeFileSync(this.reportPath, JSON.stringify(blocked, null, 2), "utf8");
      return blocked;
    }
    if (!masterFile) {
      const blocked = { ok: false, status: "CURRENT_MASTER_NOT_AVAILABLE", generatedAt, manifestPath: manifestItem.file, masterFile: null };
      fs.writeFileSync(this.reportPath, JSON.stringify(blocked, null, 2), "utf8");
      return blocked;
    }

    const master = this.buildMasterIdentityIndex(masterFile);
    const aggregation = await this.aggregationFactory().run({ usaspendingManifestPath: manifestItem.file });
    if (aggregation?.ok !== true || !aggregation?.reportPath) {
      const blocked = { ok: false, status: "USASPENDING_AWARD_AGGREGATION_FAILED", generatedAt, manifestPath: manifestItem.file, masterFile, aggregation };
      fs.writeFileSync(this.reportPath, JSON.stringify(blocked, null, 2), "utf8");
      return blocked;
    }
    const extractedRoot = path.join(path.dirname(aggregation.reportPath), "extracted");
    const collected = await this.collectIdentitySets(extractedRoot, master);
    const primeKeys = new Set(collected.prime.keys());
    const subKeys = new Set(collected.sub.keys());
    const awardedKeys = new Set([...primeKeys, ...subKeys]);
    const overlap = [...primeKeys].filter(key => subKeys.has(key));
    const inMaster = [...awardedKeys].filter(key => {
      const identity = collected.prime.get(key) || collected.sub.get(key);
      return identity?.inCurrentMaster === true;
    });
    const missing = [...awardedKeys].filter(key => !inMaster.includes(key));
    const primeInMaster = [...primeKeys].filter(key => collected.prime.get(key)?.inCurrentMaster === true);
    const subInMaster = [...subKeys].filter(key => collected.sub.get(key)?.inCurrentMaster === true);

    const report = {
      ok: true,
      status: collected.counters.rowsWithoutCanonicalIdentity === 0 ? "EXACT_SOURCE_SCOPE_DEDUPED" : "DEDUPED_WITH_EXPLICIT_IDENTITY_COVERAGE_GAP",
      generatedAt,
      scope: {
        authority: manifestItem.manifest.authority || "USAspending.gov",
        startDate: manifestItem.manifest.inputs?.startDate || null,
        endDate: manifestItem.manifest.inputs?.endDate || null,
        awardTypeCodes: manifestItem.manifest.inputs?.awardTypeCodes || null,
        spendingLevels: manifestItem.manifest.inputs?.spendingLevels || ["awards", "subawards"],
        manifestPath: manifestItem.file,
        sourceArtifact: (manifestItem.manifest.artifacts || []).find(item => path.basename(item.filePath || "") === "usaspending_prime_and_subawards.zip")?.filePath || null
      },
      currentMaster: {
        file: masterFile,
        rows: master.rows.length,
        uniqueUeis: master.uei.size,
        uniqueNormalizedNames: master.names.size
      },
      awardedUniverse: {
        uniquePrimeAwardedContractors: primeKeys.size,
        uniqueSubcontractAwardedContractors: subKeys.size,
        primeAndSubRoleOverlap: overlap.length,
        uniqueAwardedContractorsEitherRole: awardedKeys.size,
        awardedContractorsInCurrentMaster: inMaster.length,
        awardedContractorsMissingFromCurrentMaster: missing.length,
        primeAwardedContractorsInCurrentMaster: primeInMaster.length,
        primeAwardedContractorsMissingFromCurrentMaster: primeKeys.size - primeInMaster.length,
        subcontractAwardedContractorsInCurrentMaster: subInMaster.length,
        subcontractAwardedContractorsMissingFromCurrentMaster: subKeys.size - subInMaster.length,
        awardedUniverseExceedsCurrentMasterRowCount: awardedKeys.size > master.rows.length,
        netAwardedUniverseVsMasterRows: awardedKeys.size - master.rows.length
      },
      sourceRows: collected.counters,
      identityRule: "UEI_FIRST_THEN_NORMALIZED_LEGAL_NAME_FALLBACK",
      exactness: {
        dedupedWithinSourceScope: true,
        everySourceRowHasCanonicalIdentity: collected.counters.rowsWithoutCanonicalIdentity === 0,
        rowsWithoutCanonicalIdentity: collected.counters.rowsWithoutCanonicalIdentity,
        warning: collected.counters.rowsWithoutCanonicalIdentity ? "Rows without UEI or usable legal name are excluded from unique-contractor counts and reported explicitly." : null
      },
      artifacts: { aggregationReport: aggregation.reportPath, aggregatePath: aggregation.aggregatePath, coverageReport: this.reportPath },
      safety: { sourceArchivesReadOnly: true, currentMasterReadOnly: true, productionOrionModified: false, instantlyModified: false, campaignActivationPerformed: false, emailsSent: false }
    };
    fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), "utf8");
    return report;
  }
}

module.exports = new AwardedUniverseCoverageService();
module.exports.AwardedUniverseCoverageService = AwardedUniverseCoverageService;
module.exports.canonicalIdentity = canonicalIdentity;
