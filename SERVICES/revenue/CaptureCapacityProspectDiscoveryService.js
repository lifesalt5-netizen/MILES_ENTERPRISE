"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_LOOKBACK_DAYS = 730;

const SIGNAL_PATTERNS = Object.freeze([
  { type: "CAPTURE_HIRING", terms: ["capture manager", "capture director", "capture lead", "capture analyst", "capture executive", "capture position", "capture hiring"] },
  { type: "BD_CAPTURE_OPENING", terms: ["business development manager", "business development director", "business development executive", "bd director", "bd manager", "growth director", "growth executive"] },
  { type: "RECENT_IDIQ_GWAC", terms: ["idiq award", "gwac award", "task order vehicle", "multiple award contract", "idiq", "gwac"] },
  { type: "NEW_CONTRACT_VEHICLE", terms: ["new contract vehicle", "awarded vehicle", "schedule award", "gsa mas award", "seaport nxg", "oasis+", "cio-sp4", "stars iii"] },
  { type: "AGENCY_EXPANSION", terms: ["new agency", "agency expansion", "expanded into", "first award with", "new federal customer"] },
  { type: "ACQUISITION", terms: ["acquired", "acquisition", "merger", "merged with", "purchased by"] }
]);

const CONTACT_FILENAMES = [/candidate/i, /prospect/i, /lead/i, /contact/i, /segment/i, /verified/i];
const SIGNAL_FILENAMES = [/capture/i, /career/i, /hiring/i, /job/i, /award/i, /contract/i, /vehicle/i, /recompete/i, /incumbent/i, /agency/i, /acquisition/i, /forecast/i];
const DEFAULT_WEIGHTS = Object.freeze({ CAPTURE_HIRING: 5, BD_CAPTURE_OPENING: 5, RECENT_IDIQ_GWAC: 4, NEW_CONTRACT_VEHICLE: 4, AGENCY_EXPANSION: 4, MULTIPLE_RECOMPETES: 4, FEDERAL_AWARD_GROWTH: 3, ACQUISITION: 3 });

function clean(value) { return String(value ?? "").trim(); }
function normalize(value) { return clean(value).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function domain(value) { return clean(value).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]; }
function validEmail(value) { return /^\S+@\S+\.\S+$/.test(clean(value)); }
function dateValue(value) { const n = Date.parse(clean(value)); return Number.isFinite(n) ? n : null; }
function money(value) { const n = Number(String(value ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; }
function first(obj, keys) { for (const key of keys) { const value = obj?.[key]; if (value !== undefined && value !== null && clean(value)) return value; } return ""; }
function rowsFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  for (const key of ["rows", "records", "results", "data", "candidates", "leads", "contacts", "signals", "awards", "recompetes", "opportunities"]) if (Array.isArray(parsed?.[key])) return parsed[key];
  return parsed && typeof parsed === "object" ? [parsed] : [];
}
function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows.shift().map(clean);
  return rows.filter(r => r.some(v => clean(v))).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}
function readRows(file) {
  const ext = path.extname(file).toLowerCase();
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (ext === ".csv") return parseCsv(text);
  if (ext === ".json") return rowsFromJson(JSON.parse(text));
  if (ext === ".jsonl" || ext === ".ndjson") return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return [];
}
function walk(dir, options, out = []) {
  if (!dir || !fs.existsSync(dir) || out.length >= options.maxFiles) return out;
  let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (out.length >= options.maxFiles) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/node_modules|\.git|archive|backup/i.test(entry.name)) walk(full, options, out); }
    else if (/\.(json|jsonl|ndjson|csv)$/i.test(entry.name)) { try { if (fs.statSync(full).size <= options.maxFileBytes) out.push(full); } catch { /* ignore */ } }
  }
  return out;
}

class CaptureCapacityProspectDiscoveryService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.campaignService = options.campaignService || null;
    this.now = options.now || (() => new Date());
    this.outputDir = options.outputDir || path.join(this.rootDir, "DATA", "runtime", "revenue", "capture_capacity");
    this.maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
    this.maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
    this.lookbackDays = Number(options.lookbackDays || DEFAULT_LOOKBACK_DAYS);
  }

  getCampaignService() {
    if (this.campaignService) return this.campaignService;
    const Campaign = require("./CaptureCapacityCampaignService");
    this.campaignService = new Campaign({ rootDir: this.rootDir });
    return this.campaignService;
  }

  sourcePlan() {
    const explicitContacts = clean(process.env.CAPTURE_CAPACITY_CONTACT_SOURCES).split(path.delimiter).filter(Boolean);
    const explicitSignals = clean(process.env.CAPTURE_CAPACITY_SIGNAL_SOURCES).split(path.delimiter).filter(Boolean);
    return {
      contactRoots: explicitContacts.length ? explicitContacts : [path.join(this.rootDir, "DATA", "runtime", "revenue", "capture_capacity", "contacts"), path.join(this.rootDir, "DATA", "marketing_coo"), path.join(this.rootDir, "DATA", "segment_intelligence")],
      signalRoots: explicitSignals.length ? explicitSignals : [path.join(this.rootDir, "DATA", "runtime", "revenue", "capture_capacity", "signals"), path.join(this.rootDir, "DATA", "browser", "operator_results"), path.join(this.rootDir, "DATA", "orion"), path.join(this.rootDir, "DATA", "intelligence")]
    };
  }

  discoverFiles(roots, patterns) {
    const files = [];
    for (const root of roots) {
      if (fs.existsSync(root) && fs.statSync(root).isFile()) files.push(root);
      else walk(root, this, files);
    }
    return [...new Set(files)].filter(file => patterns.some(pattern => pattern.test(path.basename(file))));
  }

  loadSources(files, kind) {
    const rows = [], errors = [];
    for (const file of files) {
      try { for (const record of readRows(file)) rows.push({ record, _sourceFile: file, _sourceKind: kind }); }
      catch (error) { errors.push({ file, error: error.message }); }
    }
    return { rows, errors };
  }

  contactIdentity(record = {}) {
    const company = clean(first(record, ["company", "company_name", "companyName", "vendor_name", "awardee_name", "recipient_name", "legal_business_name", "organization"]));
    const website = clean(first(record, ["website", "domain", "company_domain", "url"]));
    const email = clean(first(record, ["email", "contact_email", "work_email"]));
    return { company, normalizedCompany: normalize(company), domain: domain(website || (email.includes("@") ? email.split("@")[1] : "")), uei: normalize(first(record, ["uei", "recipient_uei", "awardee_uei", "unique_entity_id"])), cage: normalize(first(record, ["cage", "cage_code", "cageCode"])) };
  }

  signalIdentity(record = {}) {
    const company = clean(first(record, ["company", "company_name", "companyName", "vendor", "vendor_name", "awardee", "awardee_name", "recipient_name", "contractor", "organization", "prime_contractor"]));
    return { company, normalizedCompany: normalize(company), domain: domain(first(record, ["website", "domain", "company_domain", "url"])), uei: normalize(first(record, ["uei", "recipient_uei", "awardee_uei", "unique_entity_id"])), cage: normalize(first(record, ["cage", "cage_code", "cageCode"])) };
  }

  identityKeys(identity) { return [identity.uei && `UEI:${identity.uei}`, identity.cage && `CAGE:${identity.cage}`, identity.domain && `DOMAIN:${identity.domain}`, identity.normalizedCompany && `NAME:${identity.normalizedCompany}`].filter(Boolean); }

  recordText(record = {}) {
    const values = [];
    for (const [key, value] of Object.entries(record)) if (/source|evidence|title|description|summary|detail|status|type|vehicle|agency|market|position|job|contract|award|notice|name/i.test(key) && ["string", "number"].includes(typeof value)) values.push(String(value));
    return values.join(" | ");
  }

  classifySignal(record, sourceFile) {
    const explicit = normalize(first(record, ["trigger_type", "trigger", "signal_type", "type"])).replace(/ /g, "_");
    const allowed = new Set([...Object.keys(DEFAULT_WEIGHTS)]);
    const text = this.recordText(record).toLowerCase();
    let type = allowed.has(explicit) ? explicit : "";
    if (!type) for (const pattern of SIGNAL_PATTERNS) if (pattern.terms.some(term => text.includes(term))) { type = pattern.type; break; }
    if (!type && /recompete|expiration|expires|expiring/i.test(text)) type = "RECOMPETE_RECORD";
    if (!type && /award|obligation|contract action|usaspending|fpds/i.test(text)) type = "AWARD_RECORD";
    if (!type) return null;

    const evidence = clean(first(record, ["evidence", "summary", "description", "detail", "title", "notice_title", "job_title", "position_title", "contract_name", "award_description"])) || clean(text).slice(0, 500);
    const source = clean(first(record, ["source_url", "source", "url", "link", "source_name"])) || sourceFile;
    const eventDate = clean(first(record, ["event_date", "date", "posted_date", "award_date", "action_date", "start_date", "end_date", "expiration_date", "modified_date"]));
    const vehicle = clean(first(record, ["vehicle", "vehicle_name", "contract_vehicle", "gwac", "idiq", "schedule"]));
    const agency = clean(first(record, ["agency", "agency_name", "awarding_agency", "funding_agency", "department", "customer"]));
    const amount = money(first(record, ["amount", "award_amount", "obligation", "federal_action_obligation", "total_obligation", "value"]));
    return { type, evidence, source, eventDate, vehicle, agency, amount };
  }

  isRecent(signal) {
    const ts = dateValue(signal.eventDate); if (!ts) return true;
    const age = this.now().getTime() - ts;
    return age >= -this.lookbackDays * 86400000 && age <= this.lookbackDays * 86400000;
  }

  buildSignalIndex(signalRows) {
    const index = new Map(), unmatched = [];
    for (const wrapped of signalRows) {
      const keys = this.identityKeys(this.signalIdentity(wrapped.record));
      const signal = this.classifySignal(wrapped.record, wrapped._sourceFile);
      if (!keys.length || !signal || !signal.evidence || !signal.source || !this.isRecent(signal)) { unmatched.push(wrapped); continue; }
      for (const key of keys) { if (!index.has(key)) index.set(key, []); index.get(key).push(signal); }
    }
    return { index, unmatched };
  }

  aggregateSignals(signals) {
    const unique = new Map();
    for (const signal of signals) { const key = `${signal.type}|${normalize(signal.evidence)}|${signal.source}`; if (!unique.has(key)) unique.set(key, signal); }
    const base = [...unique.values()];
    const recompetes = base.filter(s => s.type === "RECOMPETE_RECORD");
    if (recompetes.length >= 2) {
      const agencies = [...new Set(recompetes.map(s => s.agency).filter(Boolean))];
      base.push({ type: "MULTIPLE_RECOMPETES", evidence: `${recompetes.length} recompete/expiration signals identified${agencies.length ? ` across ${agencies.slice(0, 3).join(", ")}` : ""}.`, source: recompetes.map(s => s.source).slice(0, 3).join(" | "), eventDate: recompetes.map(s => s.eventDate).filter(Boolean).sort().reverse()[0] || "", vehicle: recompetes.map(s => s.vehicle).find(Boolean) || "", agency: agencies[0] || "" });
    }
    const awards = base.filter(s => s.type === "AWARD_RECORD" && dateValue(s.eventDate) && s.amount > 0);
    if (awards.length >= 2) {
      const now = this.now().getTime();
      const recent = awards.filter(s => now - dateValue(s.eventDate) <= 365 * 86400000 && now - dateValue(s.eventDate) >= 0).reduce((n, s) => n + s.amount, 0);
      const prior = awards.filter(s => { const age = now - dateValue(s.eventDate); return age > 365 * 86400000 && age <= 730 * 86400000; }).reduce((n, s) => n + s.amount, 0);
      if (recent > 0 && prior > 0 && recent >= prior * 1.25) {
        const growth = Math.round(((recent / prior) - 1) * 100);
        base.push({ type: "FEDERAL_AWARD_GROWTH", evidence: `Federal award obligations in the most recent 12 months are approximately ${growth}% above the prior 12-month period in the available award records.`, source: awards.map(s => s.source).slice(0, 3).join(" | "), eventDate: awards.map(s => s.eventDate).sort().reverse()[0], vehicle: awards.map(s => s.vehicle).find(Boolean) || "", agency: awards.map(s => s.agency).find(Boolean) || "" });
      }
    }
    return base.filter(s => !["RECOMPETE_RECORD", "AWARD_RECORD"].includes(s.type));
  }

  personalization(contact, signals) {
    const ranked = [...signals].sort((a, b) => (DEFAULT_WEIGHTS[b.type] || 0) - (DEFAULT_WEIGHTS[a.type] || 0));
    const top = ranked[0] || {}, identity = this.contactIdentity(contact);
    const firstName = clean(first(contact, ["first_name", "firstName", "firstname", "contact_first_name"]));
    const vehicleOrMarket = top.vehicle || top.agency || clean(first(contact, ["vehicle_or_market", "vehicle", "market", "agency_market", "target_market"]));
    const problemByType = {
      CAPTURE_HIRING: "adding capture capacity while permanent roles are being filled",
      BD_CAPTURE_OPENING: "supporting pipeline qualification while BD/capture capacity is expanding",
      RECENT_IDIQ_GWAC: `turning ${vehicleOrMarket || "the new vehicle"} access into qualified pursuits`,
      NEW_CONTRACT_VEHICLE: `building qualified pipeline behind ${vehicleOrMarket || "the new contract vehicle"}`,
      AGENCY_EXPANSION: `supporting capture decisions for ${top.agency || "the new agency market"}`,
      MULTIPLE_RECOMPETES: "triaging multiple recompete windows without overloading senior capture staff",
      FEDERAL_AWARD_GROWTH: "scaling capture intelligence as federal award activity grows",
      ACQUISITION: "integrating pipeline and capture priorities after the acquisition activity"
    };
    return { first_name: firstName, company: identity.company, specific_current_need: top.evidence || "", specific_company_problem_or_vehicle: top.vehicle || top.agency || problemByType[top.type] || "", vehicle_or_market: vehicleOrMarket || "", specific_capture_problem: problemByType[top.type] || "" };
  }

  enrichContacts(contactRows, signalIndex) {
    const enriched = [], unmatchedContacts = [];
    for (const wrapped of contactRows) {
      const contact = wrapped.record, identity = this.contactIdentity(contact);
      if (!validEmail(first(contact, ["email", "contact_email", "work_email"]))) { unmatchedContacts.push({ contact, reason: "VALID_EMAIL_REQUIRED" }); continue; }
      const merged = []; for (const key of this.identityKeys(identity)) merged.push(...(signalIndex.get(key) || []));
      const signals = this.aggregateSignals(merged);
      if (!signals.length) { unmatchedContacts.push({ contact, reason: "NO_MATCHED_EVIDENCE_SIGNAL" }); continue; }
      const personalization = this.personalization(contact, signals);
      enriched.push({ ...contact, email: clean(first(contact, ["email", "contact_email", "work_email"])), company: identity.company, ...personalization, triggers: signals.map(signal => ({ type: signal.type, evidence: signal.evidence, source: signal.source })), capture_signal_evidence: signals.map(signal => ({ type: signal.type, source: signal.source, event_date: signal.eventDate, agency: signal.agency, vehicle: signal.vehicle })) });
    }
    return { enriched, unmatchedContacts };
  }

  writeReport(report) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const latest = path.join(this.outputDir, "capture_capacity_prospect_feed_latest.json"), temp = `${latest}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2), "utf8"); fs.renameSync(temp, latest); return latest;
  }

  discover(input = {}) {
    const plan = this.sourcePlan();
    const contactFiles = Array.isArray(input.contactFiles) && input.contactFiles.length ? input.contactFiles.map(file => path.resolve(file)) : this.discoverFiles(plan.contactRoots, CONTACT_FILENAMES);
    const signalFiles = Array.isArray(input.signalFiles) && input.signalFiles.length ? input.signalFiles.map(file => path.resolve(file)) : this.discoverFiles(plan.signalRoots, SIGNAL_FILENAMES);
    const contacts = Array.isArray(input.contacts) ? { rows: input.contacts.map(record => ({ record, _sourceFile: "INLINE", _sourceKind: "contact" })), errors: [] } : this.loadSources(contactFiles, "contact");
    const signals = Array.isArray(input.signals) ? { rows: input.signals.map(record => ({ record, _sourceFile: clean(record.source) || "", _sourceKind: "signal" })), errors: [] } : this.loadSources(signalFiles, "signal");
    const indexed = this.buildSignalIndex(signals.rows), enriched = this.enrichContacts(contacts.rows, indexed.index);
    const audience = this.getCampaignService().prepareAudience(enriched.enriched, { maxAudience: input.maxAudience || 2000 });
    const candidates = audience.eligible.map(item => item.lead);
    const report = {
      ok: candidates.length > 0,
      service: "CAPTURE_CAPACITY_PROSPECT_DISCOVERY",
      generatedAt: this.now().toISOString(),
      sourcePlan: { contactFiles, signalFiles },
      sourceCounts: { contactRows: contacts.rows.length, signalRows: signals.rows.length, enrichedRows: enriched.enriched.length, qualifiedRows: candidates.length, blockedByCampaignGate: audience.blockedCount },
      errors: [...contacts.errors, ...signals.errors],
      unmatchedContacts: enriched.unmatchedContacts.slice(0, 500),
      unmatchedSignals: indexed.unmatched.length,
      campaignGate: { evaluated: audience.evaluated, eligibleCount: audience.eligibleCount, blockedCount: audience.blockedCount, capped: audience.capped, cap: audience.cap },
      candidates,
      blocked: audience.blocked.slice(0, 500).map(item => ({ email: item.qualification.email, company: item.qualification.personalization.company, blockers: item.qualification.blockers, score: item.qualification.score })),
      nextAction: candidates.length ? "READY_FOR_CAPTURE_CAPACITY_CAMPAIGN_HANDOFF" : "REFRESH_CAPTURE_CAPACITY_CONTACT_AND_SIGNAL_SOURCES"
    };
    if (input.writeReport !== false) report.artifact = this.writeReport(report);
    return report;
  }

  async discoverAndHandoff(input = {}) {
    const discovery = this.discover(input);
    if (!discovery.candidates.length) return { ok: false, discovery, campaign: null };
    if (input.handoff === false) return { ok: true, discovery, campaign: null };
    const campaign = await this.getCampaignService().execute({ candidates: discovery.candidates, apply: input.apply === true, activate: input.activate === true, activationApproval: input.activationApproval || "", dailyLimit: input.dailyLimit || 50, maxAudience: input.maxAudience || 2000 });
    return { ok: Boolean(campaign?.ok), discovery, campaign };
  }
}

module.exports = CaptureCapacityProspectDiscoveryService;
module.exports.CaptureCapacityProspectDiscoveryService = CaptureCapacityProspectDiscoveryService;
module.exports.helpers = { clean, normalize, domain, parseCsv, readRows };