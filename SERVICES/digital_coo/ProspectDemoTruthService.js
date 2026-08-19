"use strict";

const fs = require("fs");
const path = require("path");
const ProspectGrowthAssessmentService = require("../revenue/ProspectGrowthAssessmentService");
const ProspectDemoPresentationService = require("../revenue/ProspectDemoPresentationService");
const AwardHistoryTruthService = require("../orion/AwardHistoryTruthService");

function now() { return new Date().toISOString(); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { return fallback; }
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function normalize(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function safeKey(value) {
  return String(value || "prospect").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "prospect";
}
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function list(value, limit = 10) { return (Array.isArray(value) ? value : []).filter(Boolean).slice(0, limit); }

function flattenRows(node, out = [], depth = 0) {
  if (depth > 7 || node == null) return out;
  if (Array.isArray(node)) {
    for (const item of node) flattenRows(item, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;
  out.push(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") flattenRows(value, out, depth + 1);
  }
  return out;
}

class ProspectDemoTruthService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..");
    this.assessmentService = options.assessmentService || new ProspectGrowthAssessmentService();
    this.presentationService = options.presentationService || new ProspectDemoPresentationService({
      assessmentService: this.assessmentService
    });
    this.awardHistoryService = options.awardHistoryService || new AwardHistoryTruthService({
      requestTimeoutMs: Number(process.env.MILES_DEMO_AWARD_TIMEOUT_MS || 20000)
    });
    this.outDir = path.join(this.rootDir, "DATA", "demo_truth", "prospects");
  }

  localLeadTruth(companyName, uei) {
    const sources = [
      path.join(this.rootDir, "DATA", "runtime", "latest_deals.json"),
      path.join(this.rootDir, "DATA", "revenue", "crm_followups.json"),
      path.join(this.rootDir, "DATA", "revenue", "revenue_work_queue.json"),
      path.join(this.rootDir, "DATA", "revenue", "proposal_deadlines.json"),
      path.join(this.rootDir, "DATA", "revenue", "client_deliverables.json")
    ];
    const companyKey = normalize(companyName);
    const ueiKey = normalize(uei);
    const contacts = [];
    const leadFacts = [];
    const evidence = [];
    const seenContacts = new Set();
    const seenFacts = new Set();

    for (const file of sources) {
      if (!fs.existsSync(file)) continue;
      const data = readJson(file, null);
      if (!data) continue;
      let matched = 0;
      for (const row of flattenRows(data, [])) {
        const rowCompany = normalize(row.company || row.companyName || row.name || row.target || row.accountName);
        const rowUei = normalize(row.uei || row.ueiSAM || row.ueiSam);
        const companyMatch = Boolean(companyKey && rowCompany && (rowCompany === companyKey || rowCompany.includes(companyKey) || companyKey.includes(rowCompany)));
        const ueiMatch = Boolean(ueiKey && rowUei && rowUei === ueiKey);
        if (!companyMatch && !ueiMatch) continue;
        matched += 1;

        const contact = {
          name: row.contactName || row.contact || row.poc || row.pointOfContact || null,
          email: row.email || row.contactEmail || null,
          phone: row.phone || row.contactPhone || null,
          title: row.contactTitle || row.title || null,
          source: path.relative(this.rootDir, file)
        };
        if (contact.name || contact.email || contact.phone) {
          const key = normalize(`${contact.email || ""}|${contact.name || ""}|${contact.phone || ""}`);
          if (key && !seenContacts.has(key)) {
            seenContacts.add(key);
            contacts.push(contact);
          }
        }

        const fact = {
          source: path.relative(this.rootDir, file),
          stage: row.stage || null,
          status: row.status || null,
          action: row.action || row.nextAction || null,
          value: money(row.value),
          probability: Number.isFinite(Number(row.probability)) ? Number(row.probability) : null,
          lastActivity: row.lastActivity || row.updatedAt || row.createdAt || null
        };
        const factKey = JSON.stringify(fact);
        if (!seenFacts.has(factKey) && Object.values(fact).some(v => v !== null && v !== "")) {
          seenFacts.add(factKey);
          leadFacts.push(fact);
        }
      }
      evidence.push({ source: path.relative(this.rootDir, file), matchedRows: matched });
    }

    return {
      available: contacts.length > 0 || leadFacts.length > 0,
      status: contacts.length || leadFacts.length ? "LOCAL_LEAD_TRUTH_AVAILABLE" : "LOCAL_LEAD_TRUTH_UNAVAILABLE",
      contacts: contacts.slice(0, 10),
      leadFacts: leadFacts.slice(0, 15),
      evidence
    };
  }

  async authoritativeAwards(company, options = {}) {
    if (options.includeAwardHistory === false) {
      return { available: false, status: "AUTHORITATIVE_AWARD_LOOKUP_SKIPPED", reason: "Disabled for this request." };
    }
    if (!company?.uei) {
      return { available: false, status: "AUTHORITATIVE_AWARD_LOOKUP_UNAVAILABLE", reason: "No UEI is available for authoritative identity matching." };
    }

    try {
      const result = await this.awardHistoryService.auditByUei(company.uei, {
        companyName: company.company,
        pageSize: Math.max(1, Math.min(Number(options.awardPageSize) || 50, 100)),
        maxPages: Math.max(1, Math.min(Number(options.awardMaxPages) || 3, 20))
      });
      if (!result?.ok) {
        return {
          available: false,
          status: result?.status || "AUTHORITATIVE_AWARD_LOOKUP_FAILED",
          reason: "Authoritative identity/award lookup did not produce confirmed award truth.",
          source: result?.source || null,
          generatedAt: result?.generatedAt || null
        };
      }
      return {
        available: true,
        status: result.status,
        generatedAt: result.generatedAt,
        authoritativeForPersistence: result.source?.authoritativeForPersistence === true,
        identity: result.identity,
        summary: result.summary,
        primeAwards: list(result.primeAwards, 20),
        subcontracts: list(result.subcontracts, 20),
        dataQuality: result.dataQuality,
        source: result.source
      };
    } catch (error) {
      return {
        available: false,
        status: "AUTHORITATIVE_AWARD_LOOKUP_UNAVAILABLE",
        reason: error.message,
        generatedAt: now(),
        source: { name: "USAspending.gov / SAM.gov", authoritativeLookupPerformed: false }
      };
    }
  }

  async build(term, options = {}) {
    const requestTerm = String(term || "").trim();
    if (!requestTerm) {
      return { ok: false, service: "PROSPECT_DEMO_TRUTH", status: "TERM_REQUIRED", readOnly: true };
    }

    let assessment;
    try {
      assessment = this.assessmentService.build(requestTerm, options);
    } catch (error) {
      return { ok: false, service: "PROSPECT_DEMO_TRUTH", status: "ASSESSMENT_FAILED", error: error.message, readOnly: true };
    }
    if (!assessment?.ok) {
      return { ...assessment, service: "PROSPECT_DEMO_TRUTH", readOnly: true };
    }

    const presentation = this.presentationService.build(requestTerm, options);
    const company = assessment.company || {};
    const awards = await this.authoritativeAwards(company, options);
    const localLead = this.localLeadTruth(company.company, company.uei);
    const generatedAt = now();

    const agencies = [...new Set(
      (assessment.buyerAlignment || [])
        .map(row => row.agency || row.buyer_name)
        .filter(Boolean)
    )].slice(0, 10);

    const opportunities = (presentation?.presentation?.currentOpportunities || []).map(row => ({
      title: row.title || null,
      source: row.source || null,
      dueDate: row.dueDate || null,
      status: row.status || null,
      availability: "ORION_LINKED_SIGNAL"
    }));
    const recompetes = (presentation?.presentation?.recompeteSignals || []).map(row => ({
      ...row,
      availability: row.signalType === "MONITORING_PROFILE" ? "MODELED_MONITORING_SIGNAL" : "ORION_RECOMPETE_SIGNAL"
    }));

    const truth = {
      ok: true,
      service: "PROSPECT_DEMO_TRUTH",
      status: "DEMO_READY",
      generatedAt,
      asOfDate: assessment.asOfDate || generatedAt.slice(0, 10),
      readOnly: true,
      request: { term: requestTerm, matchedContractorId: assessment.match?.selectedContractorId || null },
      identity: {
        name: company.company || null,
        uei: company.uei || null,
        city: company.city || null,
        state: company.state || null,
        primaryNaics: company.primaryNaics || null,
        matchedNaics: company.matchedNaics || null,
        smallBusiness: company.smallBusinessFlag === "Y",
        entityStatus: company.entityStatus || null,
        registrationDate: company.registrationDate || null,
        expirationDate: company.expirationDate || null,
        source: "ORION contractors",
        sourceUpdatedAt: company.lastUpdated || null
      },
      vehicle: {
        current: company.vehicle || null,
        hint: company.vehicleHint || null,
        recommendations: list(assessment.recommendations?.vehicle, 5),
        status: company.vehicle ? "ORION_VEHICLE_RECORD_AVAILABLE" : "VEHICLE_UNAVAILABLE"
      },
      awardHistory: awards,
      agencyAlignment: {
        available: agencies.length > 0,
        agencies,
        status: agencies.length ? "ORION_BUYER_ALIGNMENT_AVAILABLE" : "AGENCY_ALIGNMENT_UNAVAILABLE"
      },
      opportunities: {
        available: opportunities.length > 0,
        status: opportunities.length ? "CURRENT_ORION_SIGNALS_AVAILABLE" : "CURRENT_OPPORTUNITIES_UNAVAILABLE",
        records: opportunities
      },
      recompetes: {
        available: recompetes.length > 0,
        status: recompetes.length ? "ORION_RECOMPETE_SIGNALS_AVAILABLE" : "RECOMPETE_SIGNALS_UNAVAILABLE",
        records: recompetes
      },
      contacts: {
        available: localLead.contacts.length > 0,
        status: localLead.contacts.length ? "LOCAL_CONTACT_FACTS_AVAILABLE" : "CONTACT_FACTS_UNAVAILABLE",
        records: localLead.contacts
      },
      leadFacts: {
        available: localLead.leadFacts.length > 0,
        status: localLead.leadFacts.length ? "LOCAL_LEAD_FACTS_AVAILABLE" : "LEAD_FACTS_UNAVAILABLE",
        records: localLead.leadFacts
      },
      growthProfile: presentation?.presentation?.growthProfile || assessment.persona || null,
      recommendations: {
        priorityActions: list(assessment.recommendations?.topPriorityActions, 7),
        vehicle: list(assessment.recommendations?.vehicle, 5),
        buyer: list(assessment.recommendations?.buyer, 5),
        partner: list(assessment.recommendations?.partner, 5),
        opportunity: list(assessment.recommendations?.opportunity, 5),
        growth: list(assessment.recommendations?.growth, 5),
        lastUpdated: assessment.recommendations?.lastUpdated || null
      },
      availability: {
        identity: Boolean(company.company || company.uei),
        vehicle: Boolean(company.vehicle),
        awardHistory: awards.available === true,
        agencyAlignment: agencies.length > 0,
        opportunities: opportunities.length > 0,
        recompetes: recompetes.length > 0,
        contacts: localLead.contacts.length > 0,
        leadFacts: localLead.leadFacts.length > 0
      },
      evidence: {
        orion: {
          authority: "ORION_READ_ONLY",
          contractorJoinKey: assessment.evidence?.contractorJoinKey || null,
          buyerJoinKey: assessment.evidence?.buyerJoinKey || null,
          opportunityJoinKey: assessment.evidence?.opportunityJoinKey || null,
          recompeteJoinKey: assessment.evidence?.recompeteJoinKey || null,
          generatedAt: assessment.generatedAt || null,
          dataQuality: assessment.dataQuality || null
        },
        awards: awards.source || null,
        localLead: localLead.evidence,
        disclosure: "Unavailable facts are explicitly marked unavailable. ORION opportunity/recompete signals remain decision-support intelligence and are not represented as confirmed procurement events unless an authoritative source confirms them."
      },
      safety: {
        demoMode: true,
        databaseMode: "READ_ONLY",
        writesEnabled: false,
        emailsSent: false,
        campaignsChanged: false,
        externalMutationPerformed: false
      }
    };

    const key = safeKey(company.uei || company.company || requestTerm);
    const dir = path.join(this.outDir, key);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(truth, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "latest.md"), this.renderMarkdown(truth), "utf8");
    fs.writeFileSync(path.join(dir, "latest.html"), this.renderHtml(truth), "utf8");
    return truth;
  }

  renderMarkdown(t) {
    const unavailable = value => value ? "Available" : "Unavailable";
    const lines = [
      `# ORION Government Growth Assessment — ${t.identity.name || t.request.term}`,
      `Generated: ${t.generatedAt}`,
      "",
      "## Company Identity",
      `- UEI: ${t.identity.uei || "Unavailable"}`,
      `- Location: ${[t.identity.city, t.identity.state].filter(Boolean).join(", ") || "Unavailable"}`,
      `- Primary NAICS: ${t.identity.primaryNaics || "Unavailable"}`,
      `- Vehicle: ${t.vehicle.current || "Unavailable"}`,
      "",
      "## Authoritative Award History",
      `- Status: ${t.awardHistory.status}`,
      `- Federal revenue: ${t.awardHistory.available ? "$" + Number(t.awardHistory.summary?.federalRevenue || 0).toLocaleString() : "Unavailable"}`,
      `- Awards: ${t.awardHistory.available ? Number(t.awardHistory.summary?.awardCount || 0) : "Unavailable"}`,
      "",
      "## Agency Alignment",
      ...(t.agencyAlignment.agencies.length ? t.agencyAlignment.agencies.map(x => `- ${x}`) : ["- Unavailable"]),
      "",
      "## Current Opportunity Signals",
      ...(t.opportunities.records.length ? t.opportunities.records.map(x => `- ${x.title || "Untitled"}${x.dueDate ? ` — due ${x.dueDate}` : ""}`) : ["- Unavailable"]),
      "",
      "## Recompete Signals",
      ...(t.recompetes.records.length ? t.recompetes.records.map(x => `- ${x.title || "Untitled"}${x.expectedDate ? ` — ${x.expectedDate}` : ""} [${x.signalType || "signal"}]`) : ["- Unavailable"]),
      "",
      "## Contact / Lead Facts",
      `- Contacts: ${unavailable(t.contacts.available)}`,
      ...(t.contacts.records.length ? t.contacts.records.map(x => `- ${x.name || "Contact"}${x.email ? ` — ${x.email}` : ""}${x.phone ? ` — ${x.phone}` : ""}`) : []),
      "",
      "## Priority Actions",
      ...(t.recommendations.priorityActions.length ? t.recommendations.priorityActions.map(x => `- ${x}`) : ["- No supported recommendation available."]),
      "",
      `_${t.evidence.disclosure}_`
    ];
    return lines.join("\n");
  }

  renderHtml(t) {
    const chips = Object.entries(t.availability).map(([key, available]) =>
      `<span class="chip ${available ? "ok" : "na"}">${esc(key)}: ${available ? "available" : "unavailable"}</span>`
    ).join("");
    const rows = (items, formatter) => items.length ? items.map(formatter).join("") : '<div class="unavailable">Unavailable in current evidence.</div>';
    const awards = t.awardHistory.available
      ? `<div class="metrics"><div><b>$${esc(Number(t.awardHistory.summary?.federalRevenue || 0).toLocaleString())}</b><span>Federal revenue</span></div><div><b>${esc(t.awardHistory.summary?.awardCount || 0)}</b><span>Awards</span></div></div>`
      : `<div class="unavailable">${esc(t.awardHistory.status)}${t.awardHistory.reason ? ` — ${esc(t.awardHistory.reason)}` : ""}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.identity.name || t.request.term)} — MILES Demo</title><style>body{font-family:Segoe UI,Arial;background:#081225;color:#edf4ff;margin:0;padding:28px;line-height:1.45}.wrap{max-width:1180px;margin:auto}.eyebrow{color:#70a7ff;font-size:12px;font-weight:800;letter-spacing:.12em}h1{margin:6px 0}section{background:#0d1b33;border:1px solid #243b62;border-radius:16px;padding:18px;margin:14px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.card{background:#0a1730;border:1px solid #263c60;border-radius:12px;padding:14px}.chip{display:inline-block;margin:4px;padding:5px 9px;border-radius:999px;font-size:12px}.chip.ok{background:#143a2b;color:#7be0ac}.chip.na{background:#3c2d18;color:#ffd082}.unavailable{color:#9eb0cc;font-style:italic}.metrics{display:flex;gap:28px;flex-wrap:wrap}.metrics div{display:flex;flex-direction:column}.metrics b{font-size:25px}.metrics span{color:#9eb0cc}.item{padding:9px 0;border-bottom:1px solid #203554}.muted{color:#9eb0cc;font-size:13px}</style></head><body><div class="wrap"><div class="eyebrow">P2GC · ORION · EVIDENCE-BACKED DEMO</div><h1>${esc(t.identity.name || t.request.term)}</h1><div class="muted">Generated ${esc(t.generatedAt)} · read-only · missing facts are never fabricated</div><section><h2>Company Position</h2><div class="grid"><div class="card"><b>UEI</b><div>${esc(t.identity.uei || "Unavailable")}</div></div><div class="card"><b>Primary NAICS</b><div>${esc(t.identity.primaryNaics || "Unavailable")}</div></div><div class="card"><b>Location</b><div>${esc([t.identity.city,t.identity.state].filter(Boolean).join(", ") || "Unavailable")}</div></div><div class="card"><b>Vehicle</b><div>${esc(t.vehicle.current || "Unavailable")}</div></div></div><div>${chips}</div></section><section><h2>Authoritative Award History</h2>${awards}</section><section><h2>Agency Alignment</h2>${rows(t.agencyAlignment.agencies,x=>`<div class="item">${esc(x)}</div>`)}</section><section><h2>Current Opportunity Signals</h2>${rows(t.opportunities.records,x=>`<div class="item"><b>${esc(x.title || "Untitled")}</b><div class="muted">${esc(x.source || "ORION")}${x.dueDate ? ` · due ${esc(x.dueDate)}` : ""}</div></div>`)}</section><section><h2>Recompete Signals</h2>${rows(t.recompetes.records,x=>`<div class="item"><b>${esc(x.title || "Untitled")}</b><div class="muted">${esc(x.signalType || "signal")}${x.expectedDate ? ` · ${esc(x.expectedDate)}` : ""}</div></div>`)}</section><section><h2>Contacts / Lead Facts</h2>${rows(t.contacts.records,x=>`<div class="item"><b>${esc(x.name || "Contact")}</b><div class="muted">${esc([x.title,x.email,x.phone].filter(Boolean).join(" · "))}</div></div>`)}</section><section><h2>Priority Actions</h2>${rows(t.recommendations.priorityActions,x=>`<div class="item">${esc(x)}</div>`)}</section><section><h2>Evidence & Disclosure</h2><div class="muted">${esc(t.evidence.disclosure)}</div></section></div></body></html>`;
  }
}

module.exports = ProspectDemoTruthService;
module.exports.ProspectDemoTruthService = ProspectDemoTruthService;
