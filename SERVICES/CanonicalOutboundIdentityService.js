"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = path.resolve(__dirname, "..");
const RULES_FILE = path.join(ROOT, "CONFIG", "canonical_outbound_identity_rules.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function normalizeUei(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeState(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDomain(value) {
  let raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  raw = raw.replace(/^https?:\/\//, "").replace(/^www\./, "");
  raw = raw.split(/[/?#]/)[0].split(":")[0];
  if (!raw.includes(".")) return "";
  return raw;
}

function firstValue(row, fields) {
  for (const field of fields || []) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      const value = row[field];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }

    // duplicate-header safe fallback: csv-parser mapHeaders renames duplicates as field__2, field__3, etc.
    const duplicateKeys = Object.keys(row).filter(key => key === field || key.startsWith(`${field}__`));
    for (const key of duplicateKeys) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
  }
  return "";
}

function createDuplicateSafeHeaderMapper() {
  const seen = new Map();
  return ({ header }) => {
    const clean = String(header || "").replace(/^\uFEFF/, "").trim();
    const key = clean.toLowerCase();
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1 ? clean : `${clean}__${count}`;
  };
}

function scanCsv(file, onRow) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(csv({ mapHeaders: createDuplicateSafeHeaderMapper() }))
      .on("data", onRow)
      .on("end", resolve)
      .on("error", reject);
  });
}

function walkCsv(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCsv(full, out);
    } else if (entry.isFile() && /\.csv$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function matchesAny(name, patterns) {
  const upper = String(name || "").toUpperCase();
  return (patterns || []).some(pattern => upper.includes(String(pattern).toUpperCase()));
}

function selectAuthoritativeFiles(rules) {
  const files = walkCsv(rules.authoritativeRoot);
  return files.filter(file => {
    const name = path.basename(file);
    if (!matchesAny(name, rules.includeNamePatterns)) return false;
    if (matchesAny(name, rules.excludeNamePatterns)) return false;
    return true;
  });
}

function addToSet(set, value) {
  if (value) set.add(value);
}

function getIdentity(row, rules) {
  const i = rules.identity || {};
  const uei = normalizeUei(firstValue(row, i.ueiFields));
  const email = normalizeEmail(firstValue(row, i.emailFields));
  const domain = normalizeDomain(firstValue(row, i.websiteFields));
  const name = normalizeName(firstValue(row, i.nameFields));
  const state = normalizeState(firstValue(row, i.stateFields));
  return {
    uei,
    email,
    domain,
    name,
    state,
    nameState: name && state ? `${name}|${state}` : ""
  };
}

class CanonicalOutboundIdentityService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;
    this.rulesFile = options.rulesFile || RULES_FILE;
    this.rules = options.rules || readJson(this.rulesFile);
    this.outDir = options.outDir || path.join(this.rootDir, "DATA", "OUTBOUND", "CANONICAL_IDENTITY");
  }

  async buildRegistry() {
    const rules = this.rules;
    const files = selectAuthoritativeFiles(rules);

    const registry = {
      uei: new Set(),
      email: new Set(),
      domain: new Set(),
      nameState: new Set()
    };

    const sourceStats = [];
    let totalRowsScanned = 0;

    for (const file of files) {
      let rows = 0;
      let ueis = 0;
      let emails = 0;
      let domains = 0;
      let nameStates = 0;

      await scanCsv(file, row => {
        rows += 1;
        totalRowsScanned += 1;
        const identity = getIdentity(row, rules);

        if (identity.uei) { addToSet(registry.uei, identity.uei); ueis += 1; }
        if (identity.email) { addToSet(registry.email, identity.email); emails += 1; }
        if (identity.domain) { addToSet(registry.domain, identity.domain); domains += 1; }
        if (identity.nameState) { addToSet(registry.nameState, identity.nameState); nameStates += 1; }
      });

      sourceStats.push({ file, rows, ueis, emails, domains, nameStates });
    }

    return { files, registry, sourceStats, totalRowsScanned };
  }

  matchIdentity(identity, registry) {
    if (identity.uei && registry.uei.has(identity.uei)) return "UEI";
    if (identity.email && registry.email.has(identity.email)) return "EMAIL";
    if (identity.domain && registry.domain.has(identity.domain)) return "DOMAIN";
    if (identity.nameState && registry.nameState.has(identity.nameState)) return "NAME_STATE";
    return "";
  }

  async reconcileStateSled(registryResult) {
    const rules = this.rules;
    const stateRoot = path.resolve(this.rootDir, rules.stateSledRoot);
    const waves = [
      { wave: "WAVE1", file: path.join(stateRoot, "STATE_SLED_WAVE1_ENRICHMENT.csv") },
      { wave: "WAVE2", file: path.join(stateRoot, "STATE_SLED_WAVE2_ENRICHMENT.csv") }
    ];

    ensureDir(this.outDir);

    const results = [];

    for (const wave of waves) {
      if (!fs.existsSync(wave.file)) {
        results.push({ wave: wave.wave, file: wave.file, missing: true });
        continue;
      }

      const cleanFile = path.join(this.outDir, `STATE_SLED_${wave.wave}_CLEAN_FOR_ENRICHMENT.csv`);
      const overlapFile = path.join(this.outDir, `STATE_SLED_${wave.wave}_OVERLAP_AUDIT.csv`);

      let cleanStream;
      let overlapStream;
      let headers = null;
      let total = 0;
      let clean = 0;
      let overlap = 0;
      const matchReasons = { UEI: 0, EMAIL: 0, DOMAIN: 0, NAME_STATE: 0 };

      await scanCsv(wave.file, row => {
        total += 1;
        if (!headers) {
          headers = Object.keys(row);
          cleanStream = fs.createWriteStream(cleanFile, { encoding: "utf8" });
          overlapStream = fs.createWriteStream(overlapFile, { encoding: "utf8" });
          cleanStream.write(headers.map(csvEscape).join(",") + "\n");
          overlapStream.write([...headers, "P1_3C_MATCH_REASON"].map(csvEscape).join(",") + "\n");
        }

        const identity = getIdentity(row, rules);
        const reason = this.matchIdentity(identity, registryResult.registry);
        const values = headers.map(h => csvEscape(row[h]));

        if (reason) {
          overlap += 1;
          matchReasons[reason] = (matchReasons[reason] || 0) + 1;
          overlapStream.write([...values, csvEscape(reason)].join(",") + "\n");
        } else {
          clean += 1;
          cleanStream.write(values.join(",") + "\n");
        }
      });

      if (cleanStream) cleanStream.end();
      if (overlapStream) overlapStream.end();

      results.push({ wave: wave.wave, file: wave.file, total, clean, overlap, matchReasons, cleanFile, overlapFile });
    }

    return results;
  }

  async run() {
    const generatedAt = new Date().toISOString();
    const registryResult = await this.buildRegistry();
    const waveStats = await this.reconcileStateSled(registryResult);

    ensureDir(this.outDir);
    const auditFile = path.join(this.outDir, "CANONICAL_OUTBOUND_IDENTITY_AUDIT.json");

    const audit = {
      ok: true,
      gate: "P1.3C_CANONICAL_OUTBOUND_IDENTITY",
      generatedAt,
      rulesVersion: this.rules.version,
      authoritativeRoot: this.rules.authoritativeRoot,
      authoritativeFileCount: registryResult.files.length,
      totalRowsScanned: registryResult.totalRowsScanned,
      uniqueIdentities: {
        uei: registryResult.registry.uei.size,
        email: registryResult.registry.email.size,
        domain: registryResult.registry.domain.size,
        nameState: registryResult.registry.nameState.size
      },
      sourceStats: registryResult.sourceStats,
      waveStats,
      safety: this.rules.safety
    };

    fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2), "utf8");
    return { ...audit, auditFile };
  }
}

module.exports = new CanonicalOutboundIdentityService();
module.exports.CanonicalOutboundIdentityService = CanonicalOutboundIdentityService;
module.exports.normalizeUei = normalizeUei;
module.exports.normalizeEmail = normalizeEmail;
module.exports.normalizeDomain = normalizeDomain;
module.exports.normalizeName = normalizeName;
module.exports.createDuplicateSafeHeaderMapper = createDuplicateSafeHeaderMapper;
