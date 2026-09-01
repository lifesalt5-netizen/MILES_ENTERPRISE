"use strict";

const fs = require("fs");
const path = require("path");

function isoNow() { return new Date().toISOString(); }
function clean(value) { return value == null ? "" : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalizeName(value) {
  return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function domainFromValue(value) {
  let text = clean(value).toLowerCase();
  if (!text) return "";
  if (text.includes("@")) text = text.split("@").pop();
  text = text.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#]/)[0].split(":")[0];
  return text;
}
function truthy(value) {
  return ["1", "true", "yes", "y", "active", "suppressed", "unsubscribed", "opted out", "opt-out", "hard bounce", "bounced"].includes(clean(value).toLowerCase());
}
function readJson(file, fallback = null) {
  try {
    if (!file || !fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, file);
}
function parseCsv(text) {
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
  return rows.filter(r => r.some(v => clean(v)));
}
function csvObjects(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) return [];
  const headers = rows[0].map(clean);
  return rows.slice(1).map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] == null ? "" : values[i]])));
}
function first(record, names) {
  if (!record) return "";
  const keys = Object.keys(record);
  const byLower = new Map(keys.map(k => [k.toLowerCase(), k]));
  for (const name of names) {
    const actual = byLower.get(String(name).toLowerCase());
    if (actual && clean(record[actual])) return clean(record[actual]);
  }
  return "";
}
function anyTruthy(record, names) { return names.some(name => truthy(first(record, [name]))); }
function verificationStatus(record) {
  const value = first(record, ["verification_status", "email_verification_status", "millionverifier_status", "email_status", "verification", "verified"]);
  return clean(value).toLowerCase();
}
function emailIsVerified(record) {
  const email = first(record, ["email", "work_email", "contact_email", "email_address"]);
  if (!email || !email.includes("@")) return false;
  const status = verificationStatus(record);
  return /^(valid|verified|deliverable|safe|good|ok|true|1)$/.test(status) || /\b(valid|verified|deliverable)\b/.test(status);
}
function isSuppressed(record) {
  if (anyTruthy(record, ["suppressed", "is_suppressed", "unsubscribed", "opt_out", "opted_out", "do_not_contact", "hard_bounce", "bounced", "invalid_email"])) return true;
  const status = first(record, ["suppression_status", "contact_status", "email_status", "status"]);
  return /unsubscribe|opt.?out|do not contact|hard bounce|invalid|suppressed/i.test(status);
}
function isClient(record) {
  if (anyTruthy(record, ["existing_client", "is_client", "client", "customer"])) return true;
  return /existing client|current client|customer/i.test(first(record, ["relationship_status", "client_status", "status"]));
}
function isContacted(record) {
  const sent = Number(first(record, ["emails_sent", "sent_count", "send_count", "historical_sends", "times_sent"]));
  if (Number.isFinite(sent) && sent > 0) return true;
  const campaign = first(record, ["campaign_id", "campaign", "instantly_campaign", "campaign_name"]);
  const status = first(record, ["campaign_status", "outreach_status", "send_status"]);
  return Boolean(campaign) && !/not assigned|not loaded|none|inactive|suppressed/i.test(status);
}
function tableExists(db, name) {
  try { return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
  catch { return false; }
}
function chooseColumn(columns, names) {
  const lower = new Map(columns.map(c => [String(c).toLowerCase(), c]));
  for (const name of names) if (lower.has(String(name).toLowerCase())) return lower.get(String(name).toLowerCase());
  return null;
}
function q(identifier) { return `"${String(identifier).replace(/"/g, '""')}"`; }

class RevenueUniverseReconciliationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.Database = options.Database || null;
    this.outputDir = path.join(this.rootDir, "DATA", "revenue_universe");
    this.latestReport = path.join(this.outputDir, "latest_revenue_universe_reconciliation.json");
    this.latestDb = path.join(this.outputDir, "latest_revenue_universe_reconciliation.sqlite");
  }

  loadDatabase() {
    if (!this.Database) this.Database = require("better-sqlite3");
    return this.Database;
  }

  resolveSources() {
    const schemaAudit = readJson(path.join(this.rootDir, "DATA", "orion_refresh", "latest_refresh_target_schema_audit.json"), {});
    const sidecarReport = readJson(path.join(this.rootDir, "DATA", "orion_refresh", "latest_contract_sidecar_build.json"), {});
    const samReport = readJson(path.join(this.rootDir, "DATA", "orion_refresh", "latest_sam_qualified_universe_build.json"), {});
    const store = readJson(path.join(this.rootDir, "DATA", "enterprise_db", "enterprise_store.json"), {});
    const segment = Array.isArray(store?.segments) ? store.segments.find(x => String(x?.id || x?.name || "").toUpperCase() === "MASTER_DEDUPED_ALL_SEGMENTS") : null;
    const masterCandidates = [
      process.env.P2GC_MASTER_FILE,
      segment?.file,
      path.join(this.rootDir, "DATA", "OUTBOUND", "MASTER_DEDUPED_ALL_SEGMENTS.csv"),
      path.join(this.rootDir, "MASTER_DEDUPED_ALL_SEGMENTS.csv")
    ].filter(Boolean);
    const masterFile = masterCandidates.find(file => fs.existsSync(file)) || null;
    return {
      orionDb: [schemaAudit?.currentDb, sidecarReport?.productionDb].find(file => file && fs.existsSync(file)) || null,
      sidecarDb: sidecarReport?.ok === true && sidecarReport?.sidecarDb && fs.existsSync(sidecarReport.sidecarDb) ? sidecarReport.sidecarDb : null,
      samDb: samReport?.ok === true && samReport?.output?.database && fs.existsSync(samReport.output.database) ? samReport.output.database : null,
      masterFile,
      sidecarReport,
      samReport
    };
  }

  buildMasterIndex(file) {
    const rows = csvObjects(file);
    const index = { rows, byUei: new Map(), byCage: new Map(), byDomain: new Map(), byCompany: new Map() };
    for (const record of rows) {
      const uei = upper(first(record, ["uei", "uei_number", "unique_entity_id"]));
      const cage = upper(first(record, ["cage", "cage_code"]));
      const company = normalizeName(first(record, ["company", "company_name", "legal_business_name", "organization", "vendor_name"]));
      const domain = domainFromValue(first(record, ["domain", "website", "company_website", "email", "work_email", "contact_email"]));
      if (uei && !index.byUei.has(uei)) index.byUei.set(uei, record);
      if (cage && !index.byCage.has(cage)) index.byCage.set(cage, record);
      if (domain && !index.byDomain.has(domain)) index.byDomain.set(domain, record);
      if (company && !index.byCompany.has(company)) index.byCompany.set(company, record);
    }
    return index;
  }

  loadUeiSet(dbFile, table) {
    const out = new Set();
    if (!dbFile) return out;
    const Database = this.loadDatabase();
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      if (!tableExists(db, table)) return out;
      for (const row of db.prepare(`SELECT uei FROM ${q(table)} WHERE uei IS NOT NULL AND TRIM(uei)<>''`).iterate()) out.add(upper(row.uei));
      return out;
    } finally { db.close(); }
  }

  run(task = {}) {
    const startedAt = isoNow();
    fs.mkdirSync(this.outputDir, { recursive: true });
    const objective = clean(task?.payload?.objective || task?.objective || task?.payload?.command || task?.command || task?.title);
    const mode = /\bb12\b|b12-to-instantly|historical b12|b12 era/i.test(objective) ? "B12_MIGRATION_RECONCILIATION" : "FULL_CONTRACTOR_COMMERCIALIZATION";
    const sources = this.resolveSources();
    const report = {
      ok: false,
      status: "RUNNING",
      service: "REVENUE_UNIVERSE_RECONCILIATION",
      mode,
      objective,
      startedAt,
      sources: {
        orionDb: sources.orionDb,
        sidecarDb: sources.sidecarDb,
        samDb: sources.samDb,
        masterFile: sources.masterFile
      },
      safety: {
        readOnlySourceDatabases: true,
        productionOrionModified: false,
        providerMutation: false,
        campaignMutation: false,
        emailSent: false,
        suppressionOverridden: false,
        outputStagingOnly: true
      }
    };

    let orion = null;
    let output = null;
    const partialDb = `${this.latestDb}.partial`;
    try {
      if (!sources.orionDb) throw new Error("ORION_CONTRACTOR_DATABASE_NOT_RESOLVED");
      const Database = this.loadDatabase();
      orion = new Database(sources.orionDb, { readonly: true, fileMustExist: true });
      if (!tableExists(orion, "contractors")) throw new Error("ORION_CONTRACTORS_TABLE_MISSING");
      const schemaRows = orion.prepare("PRAGMA table_info(contractors)").all();
      const columns = schemaRows.map(row => row.name);
      const ueiCol = chooseColumn(columns, ["uei", "uei_number", "unique_entity_id"]);
      const cageCol = chooseColumn(columns, ["cage", "cage_code"]);
      const companyCol = chooseColumn(columns, ["company", "company_norm", "company_name", "legal_business_name", "name"]);
      const websiteCol = chooseColumn(columns, ["website", "domain", "company_website", "url"]);
      if (!companyCol && !ueiCol) throw new Error("ORION_CONTRACTOR_IDENTITY_COLUMNS_MISSING");

      const master = sources.masterFile ? this.buildMasterIndex(sources.masterFile) : { rows: [], byUei: new Map(), byCage: new Map(), byDomain: new Map(), byCompany: new Map() };
      const awardUeis = this.loadUeiSet(sources.sidecarDb, "orion_contractor_fy2026_summary");
      const samUeis = this.loadUeiSet(sources.samDb, "sam_qualified_companies");
      const select = [
        ueiCol ? `${q(ueiCol)} AS uei` : "NULL AS uei",
        cageCol ? `${q(cageCol)} AS cage` : "NULL AS cage",
        companyCol ? `${q(companyCol)} AS company` : "NULL AS company",
        websiteCol ? `${q(websiteCol)} AS website` : "NULL AS website"
      ].join(", ");
      const total = Number(orion.prepare("SELECT COUNT(*) AS n FROM contractors").get().n || 0);

      try { if (fs.existsSync(partialDb)) fs.unlinkSync(partialDb); } catch {}
      output = new Database(partialDb);
      output.exec(`
        PRAGMA journal_mode=DELETE;
        CREATE TABLE contractor_revenue_lifecycle (
          contractor_key TEXT PRIMARY KEY,
          uei TEXT,
          cage TEXT,
          company TEXT,
          domain TEXT,
          disposition TEXT NOT NULL,
          next_action TEXT NOT NULL,
          in_current_master INTEGER NOT NULL DEFAULT 0,
          verified_contact INTEGER NOT NULL DEFAULT 0,
          actually_contacted INTEGER NOT NULL DEFAULT 0,
          current_sam_qualified INTEGER NOT NULL DEFAULT 0,
          fy2026_award_evidence INTEGER NOT NULL DEFAULT 0,
          evidence TEXT NOT NULL
        );
        CREATE INDEX idx_revenue_lifecycle_disposition ON contractor_revenue_lifecycle(disposition);
        CREATE INDEX idx_revenue_lifecycle_uei ON contractor_revenue_lifecycle(uei);
      `);
      const insert = output.prepare(`INSERT INTO contractor_revenue_lifecycle
        (contractor_key,uei,cage,company,domain,disposition,next_action,in_current_master,verified_contact,actually_contacted,current_sam_qualified,fy2026_award_evidence,evidence)
        VALUES (@contractor_key,@uei,@cage,@company,@domain,@disposition,@next_action,@in_current_master,@verified_contact,@actually_contacted,@current_sam_qualified,@fy2026_award_evidence,@evidence)`);
      const counts = Object.create(null);
      let verifiedDecisionMakers = 0, actuallyContacted = 0, commerciallyViableConfirmed = 0, campaignReadyIdle = 0, matchedCurrentMaster = 0;
      let ordinal = 0;
      const tx = output.transaction(rows => { for (const row of rows) insert.run(row); });
      let batch = [];
      for (const row of orion.prepare(`SELECT ${select} FROM contractors`).iterate()) {
        ordinal += 1;
        const uei = upper(row.uei), cage = upper(row.cage), company = clean(row.company), companyNorm = normalizeName(company), domain = domainFromValue(row.website);
        const current = (uei && master.byUei.get(uei)) || (cage && master.byCage.get(cage)) || (domain && master.byDomain.get(domain)) || (companyNorm && master.byCompany.get(companyNorm)) || null;
        const currentSam = Boolean(uei && samUeis.has(uei));
        const awardEvidence = Boolean(uei && awardUeis.has(uei));
        let disposition, nextAction, verified = false, contacted = false;
        if (current) {
          matchedCurrentMaster += 1;
          verified = emailIsVerified(current);
          contacted = isContacted(current);
          if (isClient(current)) { disposition = "EXISTING_CLIENT"; nextAction = "EXCLUDE_FROM_PROSPECTING_RETAIN_CLIENT_RELATIONSHIP"; }
          else if (isSuppressed(current)) { disposition = "DO_NOT_PROSPECT_VALID_SUPPRESSION"; nextAction = "RETAIN_SUPPRESSION_EVIDENCE"; }
          else if (verified) { disposition = "COMMERCIAL_PROSPECT_CAMPAIGN_READY"; nextAction = contacted ? "CONTINUE_GOVERNED_OUTREACH" : "PRIORITIZE_FOR_GOVERNED_OUTREACH"; }
          else if (first(current, ["email", "work_email", "contact_email", "email_address"])) { disposition = "COMMERCIAL_PROSPECT_CONTACT_NEEDS_VERIFICATION"; nextAction = "VERIFY_CURRENT_CONTACT_BEFORE_SEND"; }
          else { disposition = "COMMERCIAL_PROSPECT_NEW_CONTACT_REENRICHMENT_NEEDED"; nextAction = "ENRICH_CURRENT_DECISION_MAKER"; }
          if (!/EXISTING_CLIENT|DO_NOT_PROSPECT/.test(disposition)) commerciallyViableConfirmed += 1;
          if (verified && !/EXISTING_CLIENT|DO_NOT_PROSPECT/.test(disposition)) verifiedDecisionMakers += 1;
          if (contacted && !/EXISTING_CLIENT|DO_NOT_PROSPECT/.test(disposition)) actuallyContacted += 1;
          if (verified && !contacted && disposition === "COMMERCIAL_PROSPECT_CAMPAIGN_READY") campaignReadyIdle += 1;
        } else if (currentSam || awardEvidence) {
          disposition = "COMMERCIAL_PROSPECT_QUALIFICATION_REQUIRED";
          nextAction = "QUALIFY_P2GC_FIT_THEN_ENRICH_DECISION_MAKER";
        } else {
          disposition = "UNKNOWN_INVESTIGATION_REQUIRED";
          nextAction = "QUALIFY_ENTITY_COMMERCIAL_STATUS_AND_P2GC_FIT";
        }
        counts[disposition] = (counts[disposition] || 0) + 1;
        const key = uei || cage || `${companyNorm || "contractor"}#${ordinal}`;
        batch.push({
          contractor_key: key, uei: uei || null, cage: cage || null, company: company || null, domain: domain || null,
          disposition, next_action: nextAction, in_current_master: current ? 1 : 0, verified_contact: verified ? 1 : 0,
          actually_contacted: contacted ? 1 : 0, current_sam_qualified: currentSam ? 1 : 0, fy2026_award_evidence: awardEvidence ? 1 : 0,
          evidence: JSON.stringify({ currentMaster: Boolean(current), currentSamQualified: currentSam, fy2026AwardEvidence: awardEvidence })
        });
        if (batch.length >= 5000) { tx(batch); batch = []; }
      }
      if (batch.length) tx(batch);
      const accounted = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
      if (accounted !== total) throw new Error(`REVENUE_UNIVERSE_ACCOUNTING_MISMATCH:${accounted}:${total}`);
      const integrity = output.prepare("PRAGMA integrity_check").get().integrity_check;
      if (integrity !== "ok") throw new Error(`REVENUE_UNIVERSE_SQLITE_INTEGRITY_${integrity}`);
      output.close(); output = null;
      try { if (fs.existsSync(this.latestDb)) fs.unlinkSync(this.latestDb); } catch {}
      fs.renameSync(partialDb, this.latestDb);

      const marketCoverageRate = commerciallyViableConfirmed > 0 ? Number((actuallyContacted / commerciallyViableConfirmed * 100).toFixed(2)) : null;
      Object.assign(report, {
        ok: true,
        status: "COMPLETED_WITH_QUALIFICATION_GAPS",
        completedAt: isoNow(),
        universe: {
          totalContractors: total,
          accountedContractors: accounted,
          currentMasterRows: master.rows.length,
          contractorsMatchedToCurrentMaster: matchedCurrentMaster,
          currentSamQualifiedUeis: samUeis.size,
          fy2026AwardActiveUeis: awardUeis.size,
          dispositions: counts
        },
        immediateAnswers: {
          commerciallyViableP2GCProspectsConfirmedNow: commerciallyViableConfirmed,
          commerciallyViableQualificationUnresolved: (counts.COMMERCIAL_PROSPECT_QUALIFICATION_REQUIRED || 0) + (counts.UNKNOWN_INVESTIGATION_REQUIRED || 0),
          verifiedCurrentDecisionMaker: verifiedDecisionMakers,
          actuallyBeingContacted: actuallyContacted,
          marketCoveragePercentOfConfirmedViable: marketCoverageRate,
          campaignReadyButIdle: campaignReadyIdle
        },
        acceptance: {
          everyContractorAccountedOrUnknown: accounted === total,
          dispositionSumEqualsUniverse: accounted === total,
          fullCommercialQualificationComplete: (counts.COMMERCIAL_PROSPECT_QUALIFICATION_REQUIRED || 0) === 0 && (counts.UNKNOWN_INVESTIGATION_REQUIRED || 0) === 0,
          externalEnrichmentComplete: false,
          campaignActivationPerformed: false,
          governingResult: "CURRENT_COUNTS_ARE_EVIDENCE_BACKED_LOWER_BOUND_PLUS_EXPLICIT_UNRESOLVED_POPULATION"
        },
        outputs: { lifecycleDatabase: this.latestDb, report: this.latestReport }
      });
      writeJsonAtomic(this.latestReport, report);
      return report;
    } catch (error) {
      try { if (output) output.close(); } catch {}
      try { if (orion) orion.close(); } catch {}
      try { if (fs.existsSync(partialDb)) fs.unlinkSync(partialDb); } catch {}
      report.ok = false;
      report.status = "FAILED_CLOSED";
      report.completedAt = isoNow();
      report.error = error.message;
      writeJsonAtomic(this.latestReport, report);
      return report;
    } finally {
      try { if (orion) orion.close(); } catch {}
    }
  }

  execute(task = {}) { return this.run(task); }
}

module.exports = new RevenueUniverseReconciliationService();
module.exports.RevenueUniverseReconciliationService = RevenueUniverseReconciliationService;
