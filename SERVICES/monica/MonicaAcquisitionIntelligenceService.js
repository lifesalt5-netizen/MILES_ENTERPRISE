"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.env.MILES_ROOT || process.cwd();

function s(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  return "";
}
function n(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null || v === "") continue;
    const x = Number(String(v).replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(x)) return x;
  }
  return 0;
}
function ratio(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null || v === "") continue;
    const raw = String(v).trim();
    const x = Number(raw.replace(/[,%\s]/g, ""));
    if (!Number.isFinite(x)) continue;
    if (/%/.test(raw) || x > 1) return x / 100;
    return x;
  }
  return 0;
}
function b(...vals) {
  return vals.some(v => v === true || /^(1|true|yes|y)$/i.test(String(v || "").trim()));
}
function norm(v) {
  return s(v).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}
function compact(v) { return s(v).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function dateWithinDays(value, days) {
  if (!value) return false;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return false;
  const age = (Date.now() - t) / 86400000;
  return age >= 0 && age <= days;
}
function domainFromEmail(v) {
  const e = s(v).toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : "";
}
function emailVerificationStatus(r) {
  if (!s(r.email, r.email_address, r.contact_email)) return "NO_EMAIL";
  if (b(r.email_verified, r.verified_email, r.email_is_verified, r.is_email_verified)) return "VERIFIED";
  const status = s(
    r.email_verification_status,
    r.verification_status,
    r.email_status,
    r.millionverifier_status,
    r.million_verifier_status,
    r.email_validation_status
  ).toLowerCase();
  if (/^(verified|valid|deliverable|ok|safe)$/.test(status)) return "VERIFIED";
  if (/^(invalid|undeliverable|bounce|bounced|risky|unknown|catch-all|catchall)$/.test(status)) return status.toUpperCase();
  return "UNVERIFIED";
}
function companyKey(r) {
  const uei = compact(r.uei || r.UEI || r.unique_entity_id || r["Unique Entity ID"]);
  if (uei) return `UEI:${uei}`;
  const cid = compact(r.company_id || r.companyid || r.entity_id || r["Company ID"]);
  if (cid) return `CID:${cid}`;
  const domain = norm(r.domain || r.website_domain || r.website || r["Website Domain"] || domainFromEmail(r.email || r.email_address || r.contact_email));
  if (domain) return `DOMAIN:${domain}`;
  const name = compact(r.company_name || r.legal_name || r.business_name || r.recipient_name || r["Company Name"] || r.name);
  if (name) return `NAME:${name}`;
  const email = s(r.email, r.email_address, r.contact_email).toLowerCase();
  return email ? `EMAIL:${email}` : "";
}

const SEGMENTS = Object.freeze({
  RECOMPETE_REVENUE_AT_RISK: {
    label: "Recompete Revenue at Risk", minScore: 60,
    predicate: r => {
      const days = n(r.days_to_recompete, r.days_until_recompete, r.recompete_days);
      const value = n(r.award_amount, r.obligated_amount, r.contract_value, r.current_value);
      return b(r.is_incumbent, r.incumbent, r.incumbent_flag) && days >= 0 && days <= 730 && value >= 250000;
    }
  },
  FEDERAL_REVENUE_DECLINE: {
    label: "Federal Revenue Decline", minScore: 60,
    predicate: r => {
      const prior = n(r.prior_ttm_federal_revenue, r.prior_year_federal_revenue, r.previous_federal_revenue);
      const current = n(r.current_ttm_federal_revenue, r.current_year_federal_revenue, r.federal_revenue);
      return prior >= 500000 && current >= 0 && current <= prior * 0.80;
    }
  },
  FEDERAL_AGENCY_CONCENTRATION: {
    label: "Federal Agency Concentration", minScore: 60,
    predicate: r => {
      const total = n(r.total_federal_revenue, r.federal_revenue, r.ttm_federal_revenue);
      const top = n(r.top_agency_revenue, r.primary_agency_revenue);
      const supplied = ratio(r.top_agency_share, r.agency_concentration, r.primary_agency_share);
      const pct = supplied || (total > 0 ? top / total : 0);
      return total >= 500000 && pct >= 0.70;
    }
  },
  SUB_TO_PRIME_TRANSITION: {
    label: "Sub-to-Prime Transition", minScore: 65,
    predicate: r => {
      const sub = n(r.subcontract_revenue, r.federal_subcontract_revenue, r.sub_revenue);
      const prime = n(r.prime_revenue, r.federal_prime_revenue, r.prime_award_revenue);
      const evidence = b(r.has_subcontract_evidence, r.subcontractor, r.federal_subcontractor) || sub > 0;
      return evidence && sub >= 250000 && prime <= Math.max(100000, sub * 0.15);
    }
  },
  FEDERAL_BD_HIRING_INTENT: {
    label: "Federal BD Hiring Intent", minScore: 65,
    predicate: r => {
      const title = s(r.job_title, r.open_role_title, r.hiring_title);
      const fresh = dateWithinDays(r.job_posted_date || r.signal_date || r.trigger_date, 120);
      return fresh && (b(r.federal_bd_hiring, r.hiring_intent) || /(federal|government).*(business development|sales|capture|proposal|account executive)|capture manager|proposal manager/i.test(title));
    }
  },
  OPPORTUNITY_VEHICLE_GAP: {
    label: "Opportunity Vehicle Gap", minScore: 70,
    predicate: r => n(r.opportunity_fit_score, r.fit_score, r.match_score) >= 70 && n(r.addressable_value, r.opportunity_value, r.estimated_value) >= 250000 && b(r.missing_required_vehicle, r.vehicle_gap, r.access_gap)
  },
  "8A_GRADUATION_24M": {
    label: "8(a) Graduation Within 24 Months", minScore: 65,
    predicate: r => {
      const days = n(r.days_to_8a_graduation, r.days_until_graduation);
      return b(r.is_8a, r.eight_a, r["8a"]) && days >= 0 && days <= 730;
    }
  },
  FEDERAL_WHITE_SPACE_EXPANSION: {
    label: "Federal White-Space Expansion", minScore: 65,
    predicate: r => n(r.federal_revenue, r.total_federal_revenue) >= 500000 && n(r.adjacent_agency_fit_count, r.white_space_agency_count) >= 1 && b(r.white_space_verified, r.adjacent_agency_opportunity)
  },
  RECENT_RECOMPETE_LOSS: {
    label: "Recent Recompete Loss / Competitive Displacement", minScore: 70,
    predicate: r => b(r.recompete_lost, r.incumbent_displaced, r.recent_contract_loss) && dateWithinDays(r.loss_date || r.award_date || r.trigger_date, 365)
  }
});

function parseCsvLine(line) {
  const out = []; let cur = ""; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(x => x.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line); const r = {};
    headers.forEach((h, i) => r[h] = vals[i] ?? "");
    return r;
  });
}
function readJsonRows(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(raw)) return raw;
  for (const k of ["rows", "records", "companies", "awards", "data", "results", "leads", "prospects"]) if (Array.isArray(raw[k])) return raw[k];
  return [];
}
function readRows(file, maxBytes) {
  if (!fs.existsSync(file)) return [];
  const size = fs.statSync(file).size;
  if (size > maxBytes) {
    const err = new Error(`MONICA_FILE_TOO_LARGE:${size}:${file}`);
    err.code = "MONICA_FILE_TOO_LARGE"; err.size = size; err.file = file;
    throw err;
  }
  if (/\.csv$/i.test(file)) return readCsv(file);
  if (/\.json$/i.test(file)) return readJsonRows(file);
  return [];
}
function walk(root, maxDepth = 5) {
  const out = [];
  function go(dir, depth) {
    if (depth > maxDepth || !fs.existsSync(dir)) return;
    let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|\.git|backup|archive|queue|MONICA[\\/]NET_NEW_ACQUISITION_SEGMENT_CENSUS/i.test(full)) go(full, depth + 1);
      } else if (/\.(csv|json)$/i.test(e.name)) out.push(full);
    }
  }
  go(root, 0); return out;
}
function csvEscape(v) {
  const x = String(v ?? "");
  return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}
function writeCsv(file, rows, headers) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [headers.join(","), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(","))].join("\n"), "utf8");
}
function suppressionClass(file) {
  const x = file.toLowerCase();
  if (/master_deduped_all_segments|master.*dedup.*segment/.test(x)) return "MASTER_26K";
  if (/instantly|marketing_coo|campaign/.test(x)) return "INSTANTLY";
  return "P2GC_OTHER";
}
function emptyIndex() { return { keys: new Set(), emails: new Set(), sources: new Map() }; }
function addToIndex(index, key, email, file) {
  if (key) {
    index.keys.add(key);
    if (!index.sources.has(key)) index.sources.set(key, []);
    if (!index.sources.get(key).includes(file)) index.sources.get(key).push(file);
  }
  if (email) index.emails.add(email);
}

class MonicaAcquisitionIntelligenceService {
  constructor(options = {}) {
    this.root = options.rootDir || DEFAULT_ROOT;
    this.configPath = options.configPath || path.join(this.root, "CONFIG", "MONICA", "monica_acquisition_config.json");
    this.outputDir = options.outputDir || path.join(this.root, "DATA", "MONICA", "NET_NEW_ACQUISITION_SEGMENT_CENSUS");
    this.skippedFiles = [];
  }

  loadConfig() {
    const defaults = {
      mode: "DISCOVERY_ONLY", activationBlocked: true,
      candidateRoots: [path.join(this.root, "DATA"), "D:\\P2GC_Intelligence\\ORION_CORE", "D:\\P2GC_Intelligence\\MILES_ENTERPRISE\\DATA"],
      suppressionRoots: [path.join(this.root, "DATA", "OUTBOUND"), path.join(this.root, "DATA", "marketing_coo"), "D:\\P2GC_Intelligence\\MILES_ENTERPRISE\\DATA\\OUTBOUND"],
      candidatePatterns: ["award", "recompete", "revenue", "incumbent", "vehicle", "hiring", "capture", "subcontract", "agency", "orion"],
      suppressionPatterns: ["MASTER_DEDUPED_ALL_SEGMENTS", "instantly", "segment", "lead", "campaign"],
      minNetNewForBuildTest: 250,
      minNetNewForNurture: 50,
      minVerifiedContactCoverageForGo: 0.25,
      estimatedInitialSaleValue: 0,
      maxSourceFileBytes: 134217728
    };
    if (!fs.existsSync(this.configPath)) return defaults;
    return { ...defaults, ...JSON.parse(fs.readFileSync(this.configPath, "utf8")) };
  }

  discover(patterns, roots) {
    const re = new RegExp(patterns.join("|"), "i");
    const files = [];
    for (const root of roots) for (const file of walk(root, 5)) if (re.test(path.basename(file)) || re.test(file)) files.push(path.resolve(file));
    return [...new Set(files)];
  }

  safeRows(file, maxBytes) {
    try { return readRows(file, maxBytes); }
    catch (err) {
      this.skippedFiles.push({ file, reason: err.code || "READ_ERROR", detail: err.message, bytes: err.size || 0 });
      return [];
    }
  }

  buildSuppressionIndex(files, maxBytes) {
    const indexes = { MASTER_26K: emptyIndex(), INSTANTLY: emptyIndex(), P2GC_OTHER: emptyIndex() };
    for (const file of files) {
      const target = indexes[suppressionClass(file)];
      for (const r of this.safeRows(file, maxBytes)) {
        addToIndex(target, companyKey(r), s(r.email, r.email_address, r.contact_email).toLowerCase(), file);
      }
    }
    return indexes;
  }

  overlapFlags(key, email, indexes) {
    const hit = idx => idx.keys.has(key) || (!!email && idx.emails.has(email));
    const master = hit(indexes.MASTER_26K);
    const instantly = hit(indexes.INSTANTLY);
    const other = hit(indexes.P2GC_OTHER);
    return { master, instantly, other, any: master || instantly || other };
  }

  qualifyRow(row, sourceFile, indexes) {
    const key = companyKey(row);
    if (!key) return [];
    const email = s(row.email, row.email_address, row.contact_email).toLowerCase();
    const overlap = this.overlapFlags(key, email, indexes);
    const qualified = [];
    for (const [segment, def] of Object.entries(SEGMENTS)) {
      let ok = false; try { ok = def.predicate(row); } catch { ok = false; }
      if (!ok) continue;
      const score = this.score(row, segment);
      if (score < def.minScore) continue;
      const verification = emailVerificationStatus(row);
      const explicitPrimeSub = s(row.prime_sub_status, row.contractor_role, row.prime_or_sub, row.role_type);
      const primeSubStatus = explicitPrimeSub || (b(row.prime_contractor, row.is_prime) ? "PRIME" : b(row.subcontractor, row.federal_subcontractor, row.is_subcontractor) ? "SUBCONTRACTOR" : "");
      const trigger = s(row.trigger, row.trigger_type, row.signal, row.signal_type, row.event_type) || segment;
      const recompeteExpiration = s(row.recompete_date, row.expiration_date, row.contract_end_date, row.end_date) || (n(row.days_to_recompete, row.days_until_recompete, row.recompete_days) > 0 ? `${n(row.days_to_recompete, row.days_until_recompete, row.recompete_days)}_DAYS_TO_RECOMPETE` : "");
      const vehicleInformation = s(row.vehicle_information, row.contract_vehicle, row.required_vehicle, row.current_vehicle, row.vehicle, row.schedule, row.gwac);
      const economicExposureValue = n(
        row.addressable_value,
        row.opportunity_value,
        row.estimated_value,
        row.contract_value,
        row.current_value,
        row.award_amount,
        row.obligated_amount,
        row.total_federal_revenue,
        row.federal_revenue,
        row.current_ttm_federal_revenue
      );
      qualified.push({
        segment, segment_label: def.label, company_key: key,
        company_name: s(row.company_name, row.legal_name, row.business_name, row.recipient_name, row["Company Name"], row.name),
        uei: s(row.uei, row.UEI, row.unique_entity_id),
        domain: norm(row.domain || row.website_domain || row.website || domainFromEmail(email)),
        decision_maker: s(row.contact_name, row.decision_maker, row.poc_name),
        title: s(row.title, row.contact_title, row.job_title), email,
        email_verification_status: verification,
        phone: s(row.phone, row.phone_number),
        agency: s(row.agency, row.awarding_agency, row.top_agency, row.primary_agency),
        contract: s(row.contract_number, row.award_id, row.piid, row.contract_id),
        estimated_federal_revenue: n(row.total_federal_revenue, row.federal_revenue, row.current_ttm_federal_revenue),
        economic_exposure_value: economicExposureValue,
        trigger,
        trigger_date: s(row.trigger_date, row.loss_date, row.job_posted_date, row.award_date, row.recompete_date),
        recompete_expiration: recompeteExpiration,
        prime_sub_status: primeSubStatus,
        vehicle_information: vehicleInformation,
        qualification_reason: this.reason(row, segment), evidence_source: sourceFile,
        overlap_26k_master: overlap.master ? "YES" : "NO",
        overlap_instantly: overlap.instantly ? "YES" : "NO",
        overlap_other_p2gc: overlap.other ? "YES" : "NO",
        overlap_existing: overlap.any ? "YES" : "NO",
        suppression_status: overlap.any ? "SUPPRESSED_EXISTING_P2GC_OR_INSTANTLY" : "ELIGIBLE_NET_NEW",
        net_new: overlap.any ? "NO" : "YES", score
      });
    }
    return qualified;
  }

  score(row, segment) {
    let score = 50;
    if (s(row.uei, row.UEI, row.unique_entity_id)) score += 10;
    if (norm(row.domain || row.website_domain || row.website || domainFromEmail(row.email || row.email_address))) score += 5;
    if (s(row.email, row.email_address, row.contact_email)) score += 5;
    if (s(row.agency, row.awarding_agency, row.top_agency)) score += 5;
    if (s(row.contract_number, row.award_id, row.piid)) score += 5;
    if (s(row.trigger_date, row.loss_date, row.job_posted_date, row.award_date, row.recompete_date)) score += 5;
    if (n(row.total_federal_revenue, row.federal_revenue, row.contract_value, row.award_amount) > 0) score += 10;
    if (segment === "FEDERAL_BD_HIRING_INTENT" && s(row.job_url, row.source_url)) score += 5;
    return Math.min(100, score);
  }

  reason(r, segment) {
    switch (segment) {
      case "RECOMPETE_REVENUE_AT_RISK": return `Incumbent with recompete within ${n(r.days_to_recompete, r.days_until_recompete, r.recompete_days)} days and material award value.`;
      case "FEDERAL_REVENUE_DECLINE": return `Federal revenue declined from ${n(r.prior_ttm_federal_revenue, r.prior_year_federal_revenue, r.previous_federal_revenue)} to ${n(r.current_ttm_federal_revenue, r.current_year_federal_revenue, r.federal_revenue)}.`;
      case "FEDERAL_AGENCY_CONCENTRATION": return "Material federal revenue with at least 70% concentrated in one agency.";
      case "SUB_TO_PRIME_TRANSITION": return "Material federal subcontract performance with limited prime award revenue.";
      case "FEDERAL_BD_HIRING_INTENT": return "Recent hiring signal for federal sales, capture, proposal, or business development.";
      case "OPPORTUNITY_VEHICLE_GAP": return "Strong opportunity fit with material addressable value but missing required vehicle/access path.";
      case "8A_GRADUATION_24M": return "8(a) participant approaching graduation within 24 months.";
      case "FEDERAL_WHITE_SPACE_EXPANSION": return "Established federal contractor with verified adjacent-agency whitespace.";
      case "RECENT_RECOMPETE_LOSS": return "Recent recompete loss or incumbent displacement signal.";
      default: return segment;
    }
  }

  segmentDecision(net, authoritative, config) {
    if (!authoritative) {
      return { qualification: "PENDING_SUPPRESSION_VALIDATION", nextAction: "COMPLETE_SUPPRESSION_COVERAGE" };
    }
    if (!net.length) return { qualification: "DO_NOT_TARGET", nextAction: "HOLD_NO_ACTIVATION" };
    const verified = net.filter(r => r.email_verification_status === "VERIFIED").length;
    const verifiedCoverage = net.length ? verified / net.length : 0;
    const minTest = Number(config.minNetNewForBuildTest || 250);
    const minNurture = Number(config.minNetNewForNurture || 50);
    const minGoCoverage = Number(config.minVerifiedContactCoverageForGo || 0.25);
    if (net.length >= Math.max(minTest * 2, 500) && verifiedCoverage >= minGoCoverage) {
      return { qualification: "GO", nextAction: "PREPARE_CONTROLLED_ACQUISITION_TEST_FOR_MILES_APPROVAL" };
    }
    if (net.length >= minTest) return { qualification: "TEST", nextAction: "DESIGN_SMALL_CONTROLLED_TEST_FOR_MILES_REVIEW" };
    if (net.length >= minNurture) return { qualification: "NURTURE", nextAction: "ENRICH_CONTACTS_AND_RECHECK_TRIGGERS" };
    return { qualification: "DO_NOT_TARGET", nextAction: "HOLD_NO_ACTIVATION" };
  }

  run() {
    const config = this.loadConfig();
    if (config.mode !== "DISCOVERY_ONLY" || config.activationBlocked !== true) throw new Error("MONICA_SAFETY_GATE_REQUIRES_DISCOVERY_ONLY");

    const suppressionFiles = this.discover(config.suppressionPatterns, config.suppressionRoots);
    const suppressionSet = new Set(suppressionFiles.map(x => path.resolve(x).toLowerCase()));
    const candidateFiles = this.discover(config.candidatePatterns, config.candidateRoots).filter(f => !suppressionSet.has(path.resolve(f).toLowerCase()));
    const indexes = this.buildSuppressionIndex(suppressionFiles, Number(config.maxSourceFileBytes));

    const dedupe = new Map();
    for (const file of candidateFiles) {
      for (const row of this.safeRows(file, Number(config.maxSourceFileBytes))) {
        for (const q of this.qualifyRow(row, file, indexes)) {
          const id = `${q.segment}|${q.company_key}`;
          const prev = dedupe.get(id);
          if (!prev || q.score > prev.score) dedupe.set(id, q);
        }
      }
    }

    const allRows = [...dedupe.values()].sort((a, b) => a.segment.localeCompare(b.segment) || b.score - a.score);
    const netRows = allRows.filter(r => r.net_new === "YES");
    const coverage = {
      master26k: suppressionFiles.some(f => suppressionClass(f) === "MASTER_26K"),
      instantly: suppressionFiles.some(f => suppressionClass(f) === "INSTANTLY"),
      otherP2GC: suppressionFiles.some(f => suppressionClass(f) === "P2GC_OTHER")
    };
    const authoritative = coverage.master26k && coverage.instantly;

    const summary = Object.entries(SEGMENTS).map(([segment, def]) => {
      const all = allRows.filter(r => r.segment === segment);
      const net = all.filter(r => r.net_new === "YES");
      const verifiedContacts = net.filter(r => r.email && r.email_verification_status === "VERIFIED").length;
      const decision = this.segmentDecision(net, authoritative, config);
      const evidenceBackedMarketValue = net.reduce((sum, r) => sum + Number(r.economic_exposure_value || 0), 0);
      const approvedInitialSaleValue = Number(config.estimatedInitialSaleValue || 0);
      const estimatedCommercialValue = approvedInitialSaleValue > 0 ? net.length * approvedInitialSaleValue : null;
      return {
        segment, label: def.label,
        raw_qualified_companies: all.length,
        overlap_26k_master: all.filter(r => r.overlap_26k_master === "YES").length,
        overlap_instantly: all.filter(r => r.overlap_instantly === "YES").length,
        overlap_other_p2gc: all.filter(r => r.overlap_other_p2gc === "YES").length,
        suppressed_companies: all.filter(r => r.overlap_existing === "YES").length,
        any_existing_overlap: all.filter(r => r.overlap_existing === "YES").length,
        true_net_new_companies: net.length,
        net_new_contacts_with_email: net.filter(r => r.email).length,
        net_new_verified_contacts: verifiedContacts,
        verified_contact_coverage: net.length ? Number((verifiedContacts / net.length).toFixed(4)) : 0,
        evidence_backed_market_value: evidenceBackedMarketValue,
        estimated_commercial_value: estimatedCommercialValue,
        commercial_value_status: estimatedCommercialValue == null ? "CEO_PRICING_ASSUMPTION_NOT_CONFIGURED" : "ESTIMATED_FROM_APPROVED_INITIAL_SALE_VALUE",
        segment_qualification: decision.qualification,
        recommended_next_action: decision.nextAction,
        authoritative_net_new: authoritative ? "YES" : "NO",
        recommendation: decision.qualification
      };
    });

    fs.mkdirSync(this.outputDir, { recursive: true });
    const leadHeaders = ["segment", "segment_label", "company_key", "company_name", "uei", "domain", "decision_maker", "title", "email", "email_verification_status", "phone", "agency", "contract", "estimated_federal_revenue", "economic_exposure_value", "trigger", "trigger_date", "recompete_expiration", "prime_sub_status", "vehicle_information", "qualification_reason", "evidence_source", "overlap_26k_master", "overlap_instantly", "overlap_other_p2gc", "overlap_existing", "suppression_status", "net_new", "score"];
    writeCsv(path.join(this.outputDir, "MONICA_ALL_QUALIFIED.csv"), allRows, leadHeaders);
    writeCsv(path.join(this.outputDir, "MONICA_NET_NEW_LEADS.csv"), netRows, leadHeaders);
    writeCsv(path.join(this.outputDir, "MONICA_SEGMENT_CENSUS.csv"), summary, Object.keys(summary[0]));
    const manifest = {
      generatedAt: new Date().toISOString(), mode: config.mode, activationBlocked: config.activationBlocked,
      authoritativeNetNew: authoritative, suppressionCoverage: coverage,
      candidateFiles, suppressionFiles,
      suppressionCounts: {
        master26kCompanyKeys: indexes.MASTER_26K.keys.size,
        instantlyCompanyKeys: indexes.INSTANTLY.keys.size,
        otherP2GCCompanyKeys: indexes.P2GC_OTHER.keys.size,
        master26kEmails: indexes.MASTER_26K.emails.size,
        instantlyEmails: indexes.INSTANTLY.emails.size,
        otherP2GCEmails: indexes.P2GC_OTHER.emails.size
      },
      commercialValuePolicy: {
        estimatedInitialSaleValue: Number(config.estimatedInitialSaleValue || 0),
        rule: "P2GC commercial value is only calculated from an explicitly configured approved initial-sale value; otherwise no P2GC revenue estimate is fabricated."
      },
      skippedFiles: this.skippedFiles, summary
    };
    fs.writeFileSync(path.join(this.outputDir, "MONICA_SEGMENT_CENSUS.json"), JSON.stringify(manifest, null, 2), "utf8");
    fs.writeFileSync(path.join(this.outputDir, "MONICA_RUN_MANIFEST.json"), JSON.stringify(manifest, null, 2), "utf8");

    return { ok: true, outputDir: this.outputDir, authoritativeNetNew: authoritative, suppressionCoverage: coverage, candidateFiles: candidateFiles.length, suppressionFiles: suppressionFiles.length, skippedFiles: this.skippedFiles.length, summary };
  }
}

module.exports = { MonicaAcquisitionIntelligenceService, SEGMENTS, companyKey, ratio, suppressionClass, emailVerificationStatus };
