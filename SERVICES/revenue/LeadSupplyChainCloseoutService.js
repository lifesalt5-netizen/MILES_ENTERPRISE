"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

function clean(v) { return String(v == null ? "" : v).trim(); }
function uei(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function email(v) { return clean(v).toLowerCase(); }
function nameKey(row) {
  const name = clean(row.legal_name || row.Legal_Name || row.name || row.Entity_Name).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const state = clean(row.state || row.State || row.NORMALIZED_STATE).toUpperCase();
  return name ? `NAME:${name}|${state}` : "";
}
function identity(row) { const id = uei(row.uei || row.UEI || row["Unique Entity ID"] || row.unique_entity_id); return id ? `UEI:${id}` : nameKey(row); }
function split(value) { return clean(value).split(/[;|]/).map(x => x.trim()).filter(Boolean); }
function csvEscape(v) { const s = String(v == null ? "" : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
function writeCsv(file, rows, columns) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) lines.push(columns.map(c => csvEscape(row[c])).join(","));
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } }
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file).pipe(csv()).on("data", row => rows.push(row)).on("end", () => resolve(rows)).on("error", reject);
  });
}
function walkCsv(root, maxDepth = 4) {
  const out = [];
  function go(dir, depth) {
    if (depth > maxDepth || !fs.existsSync(dir)) return;
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) go(full, depth + 1);
      else if (e.isFile() && /\.csv$/i.test(e.name)) out.push(full);
    }
  }
  go(root, 0); return out;
}
function health(count) {
  if (count >= 5000) return "HEALTHY";
  if (count >= 2500) return "MODERATE";
  if (count >= 1000) return "REPLENISH";
  if (count >= 500) return "HIGH_PRIORITY";
  if (count >= 100) return "CRITICAL";
  return "EMERGENCY";
}
function federalSegment(segment) { return !/^(STATE_SLED|SLED_STATE|STATE_)/i.test(clean(segment)); }

class LeadSupplyChainCloseoutService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.intelligenceRoot = options.intelligenceRoot || process.env.P2GC_INTELLIGENCE_ROOT || "D:\\P2GC_Intelligence";
    this.truthRoot = options.truthRoot || path.join(this.intelligenceRoot, "GOVERNMENT_CONTRACTOR_TRUTH");
    this.masterPath = options.masterPath || path.join(this.truthRoot, "GOVERNMENT_CONTRACTOR_TRUTH_MASTER_CONTACTS_V2.csv");
    this.legacyRoot = options.legacyRoot || path.join(this.intelligenceRoot, "CONSOLIDATION OF LEADS");
    this.sledMasterPath = options.sledMasterPath || path.join(this.rootDir, "DATA", "OUTBOUND", "STATE_SLED", "INSTANTLY_RECONCILIATION", "STATE_SLED_WAVE1_VERIFIED_MASTER.csv");
    this.truthGateRoot = options.truthGateRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "truth_recovered_production_gate");
    this.verificationRoot = options.verificationRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "revenue", "lead_supply_chain_closeout");
  }

  plan() {
    return { ok: true, mode: "PLAN_ONLY", status: "PLANNED", inputs: { masterPath: this.masterPath, legacyRoot: this.legacyRoot, sledMasterPath: this.sledMasterPath }, writes: false };
  }

  async scanLegacy(masterIdentities) {
    const files = walkCsv(this.legacyRoot);
    const allIdentities = new Set();
    let rows = 0, blankIdentityRows = 0, rowsMatchingTruth = 0;
    const fileStats = [];
    for (const file of files) {
      let fileRows = 0, fileBlank = 0, fileUnique = new Set(), fileTruthMatches = new Set();
      await new Promise((resolve, reject) => {
        fs.createReadStream(file).pipe(csv())
          .on("data", row => {
            rows += 1; fileRows += 1;
            const key = identity(row);
            if (!key) { blankIdentityRows += 1; fileBlank += 1; return; }
            allIdentities.add(key); fileUnique.add(key);
            if (masterIdentities.has(key)) { rowsMatchingTruth += 1; fileTruthMatches.add(key); }
          })
          .on("end", resolve).on("error", reject);
      });
      fileStats.push({ file, rows: fileRows, blankIdentityRows: fileBlank, uniqueIdentities: fileUnique.size, authoritativeTruthMatches: fileTruthMatches.size });
    }
    return { files: files.length, rows, blankIdentityRows, uniqueIdentities: allIdentities.size, duplicateOrOverlapRows: Math.max(0, rows - blankIdentityRows - allIdentities.size), rowsMatchingTruth, uniqueIdentitySet: allIdentities, fileStats };
  }

  async run(input = {}) {
    if (input.apply !== true) return this.plan();
    if (!fs.existsSync(this.masterPath)) throw new Error(`Authoritative V8 contact master missing: ${this.masterPath}`);
    const master = await readCsv(this.masterPath);
    const masterKeys = new Set();
    const segments = new Map();
    let withEmail = 0, withVehicle = 0;
    for (const row of master) {
      const key = identity(row); if (key) masterKeys.add(key);
      const hasEmail = Boolean(email(row.email || row.Email || row.POC_Email));
      if (hasEmail) withEmail += 1;
      if (split(row.vehicle_memberships).length) withVehicle += 1;
      for (const segment of split(row.segments)) {
        if (!segments.has(segment)) segments.set(segment, { segment, companies: new Set(), knownEmails: new Set() });
        const rec = segments.get(segment);
        if (key) rec.companies.add(key);
        const e = email(row.email || row.Email || row.POC_Email); if (e) rec.knownEmails.add(e);
      }
    }

    const legacy = fs.existsSync(this.legacyRoot) ? await this.scanLegacy(masterKeys) : null;
    const truthGate = readJson(path.join(this.truthGateRoot, "manifest.json"));
    const verifiedReady = readJsonl(path.join(this.verificationRoot, "send_ready.jsonl"));
    const verifiedEmailSet = new Set(verifiedReady.map(r => email(r.email)).filter(Boolean));

    const federalRows = [...segments.values()].filter(r => federalSegment(r.segment)).map(r => ({
      segment: r.segment,
      companies: r.companies.size,
      knownEmailContacts: r.knownEmails.size,
      verificationProvenRecoveredContacts: [...r.knownEmails].filter(e => verifiedEmailSet.has(e)).length,
      health: health(r.companies.size)
    })).sort((a,b) => b.companies - a.companies || a.segment.localeCompare(b.segment));

    let sledRows = [];
    if (fs.existsSync(this.sledMasterPath)) {
      const sled = await readCsv(this.sledMasterPath);
      const byState = new Map();
      for (const row of sled) {
        const state = clean(row.state || row.State || row.NORMALIZED_STATE).toUpperCase() || "UNKNOWN";
        if (!byState.has(state)) byState.set(state, { companies: new Set(), emails: new Set() });
        const bucket = byState.get(state); const key = identity(row); if (key) bucket.companies.add(key);
        const e = email(row.discoveredEmail || row.email || row.Email); if (e) bucket.emails.add(e);
      }
      sledRows = [...byState.entries()].map(([state,v]) => ({ segment: `STATE_SLED_${state}`, companies: v.companies.size, verifiedContacts: v.emails.size, health: health(v.companies.size) })).sort((a,b)=>a.segment.localeCompare(b.segment));
    }

    const waterfall = {
      gate: "P0_LEAD_SUPPLY_CHAIN_CLOSEOUT_V8",
      generatedAt: new Date().toISOString(),
      historicalReference: {
        individualRecords: 320000,
        authoritative: false,
        disposition: "REFERENCE_ONLY",
        explanation: "The historical ~320K figure represented legacy individual/source records, not a preserved canonical unique-company lineage. Current truth is company-level identity with multi-vehicle membership preserved; legacy overlap, duplicate identities, blank identifiers and non-authoritative vehicle hints are measured separately rather than fabricated as filter drops."
      },
      legacyWarehouse: legacy ? {
        filesScanned: legacy.files,
        rowsScanned: legacy.rows,
        blankIdentityRows: legacy.blankIdentityRows,
        uniqueIdentities: legacy.uniqueIdentities,
        duplicateOrOverlapRows: legacy.duplicateOrOverlapRows,
        rowsMatchingAuthoritativeTruth: legacy.rowsMatchingTruth
      } : { available: false, root: this.legacyRoot },
      authoritativeTruth: {
        masterPath: this.masterPath,
        rows: master.length,
        uniqueCompanies: masterKeys.size,
        rowsWithVehicleMembership: withVehicle,
        rowsWithKnownEmail: withEmail,
        segmentCount: segments.size
      },
      recoveredContactVerification: truthGate ? {
        recoveredRows: Number(truthGate.recoveredRows ?? truthGate.verification?.recoveredRows ?? 0),
        verificationPending: Number(truthGate.verificationPending ?? 0),
        held: Number(truthGate.held ?? 0),
        selectedForVerification: Number(truthGate.selectedForVerification ?? 0),
        creditsUsed: Number(truthGate.creditsUsed ?? 0),
        status: truthGate.status || "UNKNOWN",
        verificationProvenSendReady: verifiedEmailSet.size
      } : { available: false }
    };

    const replenishment = [];
    for (const row of [...federalRows, ...sledRows]) {
      const count = Number(row.companies || 0); const h = health(count);
      replenishment.push({ segment: row.segment, companies: count, health: h, priority: h === "HEALTHY" ? "MAINTAIN" : h, action: h === "HEALTHY" ? "30_DAY_REFRESH" : "REPLENISH_FROM_APPROVED_OWNED_OR_MONICA_SOURCES" });
    }

    const defects = [];
    if (!legacy) defects.push("LEGACY_WAREHOUSE_NOT_AVAILABLE_FOR_LIVE_WATERFALL");
    if (!masterKeys.size) defects.push("AUTHORITATIVE_TRUTH_HAS_NO_IDENTITIES");
    if (!federalRows.length) defects.push("FEDERAL_SEGMENT_INVENTORY_EMPTY");
    if (!fs.existsSync(this.sledMasterPath)) defects.push("SLED_VERIFIED_MASTER_NOT_AVAILABLE");
    if (truthGate && Number(truthGate.verificationPending || 0) > 0 && verifiedEmailSet.size === 0) defects.push("RECOVERED_CONTACTS_STILL_REQUIRE_VERIFICATION");

    fs.mkdirSync(this.outputRoot, { recursive: true });
    writeCsv(path.join(this.outputRoot, "FED_SEGMENT_INVENTORY.csv"), federalRows, ["segment","companies","knownEmailContacts","verificationProvenRecoveredContacts","health"]);
    writeCsv(path.join(this.outputRoot, "SLED_SEGMENT_INVENTORY.csv"), sledRows, ["segment","companies","verifiedContacts","health"]);
    writeCsv(path.join(this.outputRoot, "SEGMENT_REPLENISHMENT_PLAN.csv"), replenishment, ["segment","companies","health","priority","action"]);
    fs.writeFileSync(path.join(this.outputRoot, "LEAD_SUPPLY_CHAIN_WATERFALL.json"), JSON.stringify(waterfall, null, 2), "utf8");
    const md = [
      "# Lead Pipeline Defects — V8 Closeout",
      "",
      `Generated: ${waterfall.generatedAt}`,
      "",
      "## Current truth",
      `- Authoritative unique companies: ${masterKeys.size}`,
      `- Federal segments: ${federalRows.length}`,
      `- SLED state segments: ${sledRows.length}`,
      `- Legacy warehouse scanned: ${legacy ? "yes" : "no"}`,
      "",
      "## Historical ~320K reference",
      "The historical reference is not treated as a unique-company baseline. The closeout measures legacy row overlap/blank identities directly and compares legacy identities to current authoritative V8 truth. No unprovable stage-drop counts are fabricated.",
      "",
      "## Open defects",
      ...(defects.length ? defects.map(x => `- ${x}`) : ["- NONE"]),
      ""
    ].join("\n");
    fs.writeFileSync(path.join(this.outputRoot, "LEAD_PIPELINE_DEFECTS.md"), md, "utf8");

    const result = {
      ok: defects.length === 0,
      status: defects.length === 0 ? "LEAD_SUPPLY_CLOSEOUT_GREEN" : "LEAD_SUPPLY_CLOSEOUT_BLOCKED",
      outputRoot: this.outputRoot,
      defects,
      summary: {
        authoritativeCompanies: masterKeys.size,
        federalSegments: federalRows.length,
        sledSegments: sledRows.length,
        knownEmailRows: withEmail,
        verificationProvenRecoveredContacts: verifiedEmailSet.size,
        legacyRowsScanned: legacy?.rows || 0,
        legacyUniqueIdentities: legacy?.uniqueIdentities || 0,
        legacyDuplicateOrOverlapRows: legacy?.duplicateOrOverlapRows || 0
      }
    };
    fs.writeFileSync(path.join(this.outputRoot, "LEAD_SUPPLY_CHAIN_CLOSEOUT_MANIFEST.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }
}

module.exports = LeadSupplyChainCloseoutService;
module.exports.LeadSupplyChainCloseoutService = LeadSupplyChainCloseoutService;
