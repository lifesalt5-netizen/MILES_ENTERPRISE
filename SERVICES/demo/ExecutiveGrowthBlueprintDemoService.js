"use strict";

const ProspectGrowthAssessmentService = require("../revenue/ProspectGrowthAssessmentService");
const ProspectDemoPresentationService = require("../revenue/ProspectDemoPresentationService");

function clean(value) { return String(value == null ? "" : value).trim(); }
function norm(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.filter(Boolean); } catch {}
    return value.split(/[,;|]/).map(x => x.trim()).filter(Boolean);
  }
  return [value].filter(Boolean);
}
function pick(row, names) { for (const name of names) if (row && row[name] != null && clean(row[name]) !== "") return row[name]; return null; }
function uniq(values) { return [...new Set(values.filter(Boolean).map(clean).filter(Boolean))]; }
function dollarsFromText(values) {
  const matches = [];
  for (const value of values || []) {
    const text = clean(value);
    const re = /\$\s*([0-9][0-9,]*(?:\.\d+)?)/g;
    let m;
    while ((m = re.exec(text))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) matches.push(n);
    }
  }
  return matches.length ? Math.max(...matches) : null;
}
function scoreCategory(label, checks) {
  const total = checks.reduce((s, x) => s + x.weight, 0) || 1;
  const earned = checks.reduce((s, x) => s + (x.pass ? x.weight : 0), 0);
  return {
    label,
    score: Math.round((earned / total) * 100),
    evidence: checks.filter(x => x.pass).map(x => x.label),
    missing: checks.filter(x => !x.pass).map(x => x.label),
    checks
  };
}
function dateOnly(value) {
  const d = new Date(value || 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

class ExecutiveGrowthBlueprintDemoService {
  constructor(options = {}) {
    this.assessment = options.assessmentService || new ProspectGrowthAssessmentService();
    this.presentation = options.presentationService || new ProspectDemoPresentationService({ assessmentService: this.assessment });
    this.orion = options.orion || null;
  }

  getOrion() {
    if (!this.orion) this.orion = require("../../CONNECTORS/ORION/connector");
    return this.orion;
  }

  contractorColumns() {
    try { return this.getOrion().query("PRAGMA table_info(contractors)").map(x => x.name); }
    catch { return []; }
  }

  resolveSearchTerm(term) {
    const raw = clean(term);
    if (!raw) return raw;
    const orion = this.getOrion();
    const init = orion.initialize();
    if (!init?.ok) return raw;

    if (orion.searchContractors(raw, 5).length) return raw;

    const cols = this.contractorColumns();
    const candidates = ["cage", "cage_code", "website", "domain", "company_website"].filter(x => cols.includes(x));
    for (const col of candidates) {
      try {
        const rows = orion.query(`SELECT company, uei, ${col} FROM contractors WHERE ${col} LIKE ? LIMIT 5`, [`%${raw}%`]);
        if (rows.length) return rows[0].uei || rows[0].company || raw;
      } catch {}
    }
    return raw;
  }

  rawContractor(assessment) {
    const orion = this.getOrion();
    const id = assessment?.match?.selectedContractorId;
    if (id != null) {
      try { return orion.query("SELECT * FROM contractors WHERE id = ? LIMIT 1", [id])[0] || {}; } catch {}
    }
    return {};
  }

  parseVehicles(raw, company) {
    return uniq([
      ...list(pick(raw, ["vehicles", "contract_vehicles", "all_vehicles", "vehicle_names"])),
      ...list(company.vehicle)
    ]);
  }

  parseCertifications(raw) {
    const certs = uniq([
      ...list(pick(raw, ["certifications", "socioeconomic_certifications", "socioeconomic", "set_asides", "certification_status"])),
      ...[
        ["8(a)", ["eight_a", "8a", "sba_8a"]],
        ["HUBZone", ["hubzone", "hub_zone"]],
        ["WOSB", ["wosb"]],
        ["EDWOSB", ["edwosb"]],
        ["SDVOSB", ["sdvosb"]],
        ["VOSB", ["vosb"]]
      ].filter(([, names]) => names.some(n => /^(Y|YES|TRUE|1|ACTIVE)$/i.test(clean(raw[n])))).map(([label]) => label)
    ]);
    return certs;
  }

  readiness(company, raw, assessment, profile) {
    const now = new Date();
    const expiration = pick(raw, ["expiration_date", "sam_expiration_date", "registration_expiration"] ) || company.expirationDate;
    const notExpired = expiration ? new Date(expiration) >= now : false;
    const samActive = /^(A|ACTIVE|Y|YES|TRUE|1)$/i.test(clean(company.entityStatus || pick(raw,["sam_status","entity_status"]))) && (notExpired || !expiration);
    const vehicles = profile.contractVehicles;
    const certs = profile.certifications;
    const website = Boolean(profile.website);
    const buyers = assessment.buyerAlignment || [];
    const recommendations = assessment.recommendations || {};
    const revenue = Number(company.federalRevenue || 0);
    const awards = Number(company.awardCount || 0);
    const persona = assessment.persona || {};

    const categories = {
      eligibility: scoreCategory("Eligibility", [
        { label:"Primary NAICS identified", pass:Boolean(profile.naicsCodes.length), weight:30 },
        { label:"Small-business status identified", pass:company.smallBusinessFlag === "Y" || company.smallBusinessFlag === "N", weight:20 },
        { label:"SAM entity appears active", pass:samActive, weight:30 },
        { label:"Socioeconomic certification evidence", pass:certs.length > 0, weight:20 }
      ]),
      registrations: scoreCategory("Registrations", [
        { label:"UEI present", pass:Boolean(profile.uei), weight:30 },
        { label:"CAGE present", pass:Boolean(profile.cage), weight:25 },
        { label:"SAM active", pass:samActive, weight:35 },
        { label:"Registration expiration is current", pass:notExpired, weight:10 }
      ]),
      contractVehicles: scoreCategory("Contract Vehicles", [
        { label:"At least one contract vehicle identified", pass:vehicles.length > 0, weight:55 },
        { label:"Multiple vehicle coverage", pass:vehicles.length > 1, weight:20 },
        { label:"Vehicle strategy exists", pass:list(recommendations.vehicle).length > 0, weight:25 }
      ]),
      marketing: scoreCategory("Marketing", [
        { label:"Company website identified", pass:website, weight:30 },
        { label:"Market segment identified", pass:Boolean(company.segment), weight:20 },
        { label:"Government positioning/persona identified", pass:Boolean(persona.primary), weight:30 },
        { label:"Growth messaging/action recommendations exist", pass:list(recommendations.topPriorityActions).length > 0, weight:20 }
      ]),
      pastPerformance: scoreCategory("Past Performance", [
        { label:"Federal revenue recorded", pass:revenue > 0, weight:40 },
        { label:"Federal awards recorded", pass:awards > 0, weight:30 },
        { label:"Agency/buyer history recorded", pass:buyers.length > 0, weight:30 }
      ]),
      positioning: scoreCategory("Positioning", [
        { label:"Primary growth persona identified", pass:Boolean(persona.primary), weight:25 },
        { label:"Market segment identified", pass:Boolean(company.segment), weight:20 },
        { label:"Market priority identified", pass:Boolean(company.marketPriority), weight:20 },
        { label:"Buyer strategy exists", pass:list(recommendations.buyer).length > 0, weight:15 },
        { label:"Growth strategy exists", pass:list(recommendations.growth).length > 0, weight:20 }
      ]),
      relationships: scoreCategory("Relationships", [
        { label:"At least one agency/buyer relationship signal", pass:buyers.length > 0, weight:45 },
        { label:"Three or more buyer relationships", pass:buyers.length >= 3, weight:25 },
        { label:"Partner strategy identified", pass:list(recommendations.partner).length > 0, weight:20 },
        { label:"Opportunity/recompete relationship signals", pass:(assessment.linkedOpportunities||[]).length + (assessment.recompeteSignals||[]).length > 0, weight:10 }
      ])
    };
    const values = Object.values(categories).map(x => x.score);
    return { categories, overall: Math.round(values.reduce((a,b)=>a+b,0)/values.length), methodology:"Evidence-weighted readiness model. Scores reflect evidence present in ORION/current records, not a government certification of eligibility." };
  }

  peerIntelligence(assessment, raw) {
    const orion = this.getOrion();
    const company = assessment.company || {};
    const primaryNaics = company.primaryNaics || pick(raw,["primary_naics"]);
    const id = assessment.match?.selectedContractorId;
    if (!primaryNaics || id == null) return { status:"UNAVAILABLE", competitors:[], primePartners:[] };
    let peers = [];
    try {
      peers = orion.query("SELECT * FROM contractors WHERE primary_naics = ? AND id <> ? ORDER BY COALESCE(federal_revenue,0) DESC, COALESCE(award_count,0) DESC LIMIT 12", [primaryNaics,id]);
    } catch { return { status:"UNAVAILABLE", competitors:[], primePartners:[] }; }

    const enrich = row => {
      let buyers = [];
      try { buyers = orion.query("SELECT * FROM buyers WHERE company_id = ? ORDER BY spend DESC, award_count DESC LIMIT 3", [row.id]); } catch {}
      return {
        company: row.company || null,
        uei: row.uei || null,
        federalRevenue: number(row.federal_revenue),
        awardCount: number(row.award_count),
        vehicle: row.vehicle || null,
        agencies: uniq(buyers.map(x => x.agency || x.buyer_name)).slice(0,3),
        basis: `Shares primary NAICS ${primaryNaics}; ORION market-peer model`,
        confidence:"MODELED_CANDIDATE"
      };
    };
    const competitors = peers.slice(0,5).map(enrich);
    const prospectRevenue = Number(company.federalRevenue || 0);
    const primePartners = peers.filter(x => Number(x.federal_revenue || 0) > prospectRevenue && clean(x.vehicle)).slice(0,5).map(enrich);
    return { status:"ORION_MARKET_PEER_MODEL", competitors, primePartners, disclosure:"These are modeled competitor/prime-partner candidates based on shared NAICS, federal activity, vehicles and buyer history. Validate before external factual claims." };
  }

  agencyAlignment(assessment) {
    const buyers = (assessment.buyerAlignment || []).slice(0,10);
    if (!buyers.length) return { status:"UNAVAILABLE", agencies:[] };
    const maxSpend = Math.max(...buyers.map(x => Number(x.spend || 0)),1);
    const maxAwards = Math.max(...buyers.map(x => Number(x.award_count || 0)),1);
    return {
      status:"ORION_HISTORICAL_ALIGNMENT_MODEL",
      agencies: buyers.map(row => {
        const spendFactor = Number(row.spend || 0)/maxSpend;
        const awardFactor = Number(row.award_count || 0)/maxAwards;
        return {
          agency: row.agency || row.buyer_name || "Unknown agency",
          fitScore: Math.round((0.7*spendFactor + 0.3*awardFactor)*100),
          historicalSpend:number(row.spend),
          awardCount:number(row.award_count),
          basis:"Historical ORION buyer alignment"
        };
      }).sort((a,b)=>b.fitScore-a.fitScore)
    };
  }

  revenueModel(company, raw, recommendations) {
    const currentFederal = number(company.federalRevenue) || 0;
    const state = number(pick(raw,["state_revenue","sled_state_revenue"]));
    const local = number(pick(raw,["local_revenue","sled_local_revenue"]));
    const commercial = number(pick(raw,["commercial_revenue"]));
    const leakage = dollarsFromText([
      ...list(recommendations.topPriorityActions),
      ...list(recommendations.growth),
      ...list(recommendations.vehicle),
      ...list(recommendations.buyer)
    ]);
    return {
      current:{ federal:currentFederal, state, local, commercial },
      opportunity: leakage ? {
        status:"ORION_MODELED_REVENUE_LEAKAGE_ESTIMATE",
        currentFederalRevenue:currentFederal,
        modeledPotentialFederalRevenue:currentFederal + leakage,
        modeledGrowthOpportunity:leakage,
        disclosure:"Modeled commercial opportunity derived from ORION recommendation intelligence; not a guaranteed revenue forecast."
      } : {
        status:"POTENTIAL_REVENUE_NOT_MODELED",
        currentFederalRevenue:currentFederal,
        modeledPotentialFederalRevenue:null,
        modeledGrowthOpportunity:null,
        disclosure:"No defensible modeled revenue-gap estimate is present in the current recommendation record."
      }
    };
  }

  pathway(model) {
    const currentFederal = Number(model.revenue.current.federal || 0);
    if (currentFederal <= 0) {
      return {
        type:"FIRST_AWARD_PATHWAY",
        title:"First Award Pathway™",
        steps:[
          "Validate registrations",
          "Optimize SAM profile",
          "Complete/activate eligible certifications",
          "Identify best-fit agencies and buyers",
          "Build usable past-performance strategy",
          "Pursue subcontracting and teaming opportunities",
          "Pursue the first qualified award"
        ]
      };
    }
    return {
      type:"GROWTH_PATHWAY",
      title:"Growth Pathway™",
      steps:[
        `Current federal revenue: $${currentFederal.toLocaleString("en-US")}`,
        "Optimize existing contract vehicles",
        "Expand into aligned agencies/buyers",
        "Build prime and teaming relationships",
        "Strengthen competitive positioning",
        "Match and capture qualified opportunities",
        "Increase sustainable government revenue"
      ]
    };
  }

  build(term, options = {}) {
    const requestedTerm = clean(term);
    if (!requestedTerm) return { ok:false, status:"TERM_REQUIRED", message:"Enter company name, UEI, CAGE, or website." };
    const resolvedTerm = this.resolveSearchTerm(requestedTerm);
    const assessment = this.assessment.build(resolvedTerm, options);
    if (!assessment?.ok) return { ...assessment, requestedTerm, resolvedTerm };

    const raw = this.rawContractor(assessment);
    const company = assessment.company || {};
    const naicsCodes = uniq([company.primaryNaics, ...list(company.matchedNaics)]);
    const vehicles = this.parseVehicles(raw, company);
    const certs = this.parseCertifications(raw);
    const cage = pick(raw,["cage","cage_code","cagecode"]);
    const website = pick(raw,["website","company_website","domain","url"]);
    const founded = pick(raw,["year_established","founded_year","year_founded","business_start_year"]);
    const yearsInBusiness = founded && Number(founded) > 1800 ? new Date().getFullYear()-Number(founded) : null;
    const expiration = company.expirationDate || pick(raw,["expiration_date","sam_expiration_date"]);
    const samActive = /^(A|ACTIVE|Y|YES|TRUE|1)$/i.test(clean(company.entityStatus || pick(raw,["sam_status","entity_status"]))) && (!expiration || new Date(expiration) >= new Date());
    const gsa = vehicles.some(v => /GSA|MAS|MULTIPLE AWARD SCHEDULE/i.test(v));

    const profile = {
      companyName:company.company || requestedTerm,
      uei:company.uei || null,
      cage:cage || null,
      headquarters:[company.city,company.state].filter(Boolean).join(", ") || null,
      website:website || null,
      naicsCodes,
      certifications:certs,
      samStatus:samActive ? "ACTIVE" : (company.entityStatus || "UNVERIFIED"),
      gsaStatus:gsa ? "IDENTIFIED" : "NOT IDENTIFIED IN CURRENT ORION RECORD",
      contractVehicles:vehicles,
      yearsInBusiness,
      yearsInBusinessStatus: yearsInBusiness != null ? "SOURCE_FIELD_AVAILABLE" : "UNAVAILABLE"
    };

    const readiness = this.readiness(company, raw, assessment, profile);
    const revenue = this.revenueModel(company,raw,assessment.recommendations||{});
    const market = this.peerIntelligence(assessment,raw);
    const agencies = this.agencyAlignment(assessment);
    const currentState = {
      samRegistration:samActive,
      certifications:certs,
      contractVehicles:vehicles,
      activeContracts:Number(company.awardCount||0),
      federalSales:Number(company.federalRevenue||0),
      stateLocalSales: revenue.current.state != null || revenue.current.local != null ? Number(revenue.current.state||0)+Number(revenue.current.local||0) : null,
      agencyRelationships:uniq((assessment.buyerAlignment||[]).map(x=>x.agency||x.buyer_name))
    };
    const missing = uniq([
      ...Object.values(readiness.categories).flatMap(x=>x.missing),
      ...list(assessment.recommendations?.certification),
      ...list(assessment.recommendations?.vehicle),
      ...list(assessment.recommendations?.buyer),
      ...list(assessment.recommendations?.partner)
    ]).slice(0,25);

    const opportunityRecords = (assessment.linkedOpportunities||[]).map(row=>({
      title:row.title||null, source:row.source||null, status:row.status||null, dueDate:dateOnly(row.due_date), qualification:"ORION prospect-safe linked opportunity signal"
    }));
    const recompeteRecords = (assessment.recompeteSignals||[]).map(row=>({
      title:row.title||null, agency:row.agency||null, date:dateOnly(row.recompete_date), value:number(row.value), signalType:row.signalType, qualification:row.prospectClaim
    }));
    const subOpps = opportunityRecords.filter(x => /SUBCONTRACT|TEAM|PARTNER/i.test(`${x.title} ${x.source}`));

    const model = {
      ok:true,
      service:"P2GC_EXECUTIVE_GOVERNMENT_GROWTH_BLUEPRINT_DEMO",
      status:"DEMO_READY",
      generatedAt:new Date().toISOString(),
      requestedTerm,
      resolvedTerm,
      profile,
      readiness,
      currentState,
      gaps:{ items:missing, status:missing.length?"GAPS_IDENTIFIED":"NO_GAPS_IDENTIFIED_FROM_CURRENT_EVIDENCE" },
      revenue,
      vehicles:{ current:vehicles, recommendations:list(assessment.recommendations?.vehicle), status:vehicles.length?"CURRENT_VEHICLES_IDENTIFIED":"NO_CURRENT_VEHICLE_IDENTIFIED" },
      competitors:{ status:market.status, records:market.competitors, disclosure:market.disclosure||null },
      primePartners:{ status:market.status, records:market.primePartners, strategy:list(assessment.recommendations?.partner), disclosure:market.disclosure||null },
      subcontracting:{ status:subOpps.length?"ORION_TEAMING_SIGNALS_AVAILABLE":"NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED", records:subOpps, strategy:list(assessment.recommendations?.partner) },
      agencyAlignment:agencies,
      buyerIntelligence:{ status:(assessment.buyerAlignment||[]).length?"ORION_BUYER_HISTORY_AVAILABLE":"UNAVAILABLE", records:(assessment.buyerAlignment||[]).slice(0,10).map(x=>({ agency:x.agency||null, buyer:x.buyer_name||null, spend:number(x.spend), awardCount:number(x.award_count) })) },
      opportunities:{ liveAndForecast:opportunityRecords, recompetes:recompeteRecords },
      recommendations:{
        immediate:uniq(list(assessment.recommendations?.topPriorityActions)).slice(0,7),
        vehicle:list(assessment.recommendations?.vehicle).slice(0,5),
        agency:list(assessment.recommendations?.buyer).slice(0,5),
        partner:list(assessment.recommendations?.partner).slice(0,5),
        opportunity:list(assessment.recommendations?.opportunity).slice(0,5),
        growth:list(assessment.recommendations?.growth).slice(0,5)
      },
      safety:{ readOnly:true, writesEnabled:false, emailsSent:false, campaignsChanged:false },
      evidence:{ assessmentGeneratedAt:assessment.generatedAt, asOfDate:assessment.asOfDate, dataQuality:assessment.dataQuality, disclosure:"Confirmed company facts come from current ORION records. Market-peer, revenue-gap, competitor and partner outputs are labeled when modeled. Unavailable facts remain unavailable and are never invented." }
    };
    model.pathway = this.pathway(model);
    return model;
  }

  toMarkdown(m) {
    const money = v => v == null ? "Unavailable" : `$${Number(v).toLocaleString("en-US")}`;
    const lines = [
      `# Executive Government Growth Blueprint™ — ${m.profile.companyName}`,
      `Generated: ${m.generatedAt}`,
      "",
      "## Executive Summary",
      `Government Contracting Readiness: **${m.readiness.overall}/100**`,
      `Current federal revenue: **${money(m.revenue.current.federal)}**`,
      `Revenue opportunity: **${m.revenue.opportunity.modeledGrowthOpportunity == null ? "Not modeled" : money(m.revenue.opportunity.modeledGrowthOpportunity)}**`,
      "",
      "## Company Intelligence",
      `- UEI: ${m.profile.uei || "Unavailable"}`,
      `- CAGE: ${m.profile.cage || "Unavailable"}`,
      `- Headquarters: ${m.profile.headquarters || "Unavailable"}`,
      `- Website: ${m.profile.website || "Unavailable"}`,
      `- NAICS: ${m.profile.naicsCodes.join(", ") || "Unavailable"}`,
      `- Certifications: ${m.profile.certifications.join(", ") || "Unavailable"}`,
      `- SAM: ${m.profile.samStatus}`,
      `- GSA: ${m.profile.gsaStatus}`,
      `- Vehicles: ${m.profile.contractVehicles.join(", ") || "None identified"}`,
      "",
      "## Government Readiness",
      ...Object.values(m.readiness.categories).map(x=>`- ${x.label}: ${x.score}%`),
      "",
      "## Gap Analysis",
      ...(m.gaps.items.length?m.gaps.items:["No gaps identified from current evidence."]).map(x=>`- ${x}`),
      "",
      "## Competitive Analysis",
      ...(m.competitors.records.length?m.competitors.records.map(x=>`- ${x.company}: ${money(x.federalRevenue)}, ${x.awardCount ?? "?"} awards, ${x.vehicle || "vehicle unavailable"}`):["Competitor intelligence unavailable."]),
      "",
      "## Contract Vehicles",
      `- Current: ${m.vehicles.current.join(", ") || "None identified"}`,
      ...m.vehicles.recommendations.map(x=>`- ${x}`),
      "",
      "## Agency Alignment",
      ...(m.agencyAlignment.agencies.length?m.agencyAlignment.agencies.map(x=>`- ${x.agency}: ${x.fitScore}% modeled alignment`):["Agency alignment unavailable."]),
      "",
      "## Prime / Teaming Intelligence",
      ...(m.primePartners.records.length?m.primePartners.records.map(x=>`- ${x.company}: ${x.vehicle || "vehicle unavailable"}; agencies ${x.agencies.join(", ") || "unavailable"}`):["Prime-partner candidates unavailable."]),
      "",
      "## Opportunity Matching",
      ...(m.opportunities.liveAndForecast.length?m.opportunities.liveAndForecast.map(x=>`- ${x.title}${x.dueDate?` — ${x.dueDate}`:""}`):["No current linked live/forecast opportunity signal identified."]),
      "",
      `## ${m.pathway.title}`,
      ...m.pathway.steps.map((x,i)=>`${i+1}. ${x}`),
      "",
      "## ORION Recommended Actions",
      ...(m.recommendations.immediate.length?m.recommendations.immediate:["No immediate recommendation available."]).map((x,i)=>`${i+1}. ${x}`),
      "",
      "## 90-Day Action Plan",
      ...uniq([...m.recommendations.immediate,...m.recommendations.vehicle,...m.recommendations.agency,...m.recommendations.partner]).slice(0,10).map((x,i)=>`${i+1}. ${x}`),
      "",
      "## 12-Month Growth Plan",
      ...uniq([...m.recommendations.growth,...m.recommendations.opportunity,...m.pathway.steps]).slice(0,12).map((x,i)=>`${i+1}. ${x}`),
      "",
      "## Executive Recommendation",
      "P2GC should convert the highest-value validated gaps above into a governed execution plan with ownership, deadlines, target agencies/partners and measurable revenue milestones.",
      "",
      `_${m.evidence.disclosure}_`
    ];
    return lines.join("\n");
  }
}

module.exports = ExecutiveGrowthBlueprintDemoService;
