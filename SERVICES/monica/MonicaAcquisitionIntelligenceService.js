"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.env.MILES_ROOT || process.cwd();

const SEGMENTS = Object.freeze({
  RECOMPETE_REVENUE_AT_RISK: {
    label: "Recompete Revenue at Risk",
    minScore: 60,
    predicate: r => {
      const days = n(r.days_to_recompete, r.days_until_recompete, r.recompete_days);
      const value = n(r.award_amount, r.obligated_amount, r.contract_value, r.current_value);
      const incumbent = b(r.is_incumbent, r.incumbent, r.incumbent_flag);
      return incumbent && days >= 0 && days <= 730 && value >= 250000;
    }
  },
  FEDERAL_REVENUE_DECLINE: {
    label: "Federal Revenue Decline",
    minScore: 60,
    predicate: r => {
      const prior = n(r.prior_ttm_federal_revenue, r.prior_year_federal_revenue, r.previous_federal_revenue);
      const current = n(r.current_ttm_federal_revenue, r.current_year_federal_revenue, r.federal_revenue);
      return prior >= 500000 && current >= 0 && current <= prior * 0.80;
    }
  },
  FEDERAL_AGENCY_CONCENTRATION: {
    label: "Federal Agency Concentration",
    minScore: 60,
    predicate: r => {
      const total = n(r.total_federal_revenue, r.federal_revenue, r.ttm_federal_revenue);
      const top = n(r.top_agency_revenue, r.primary_agency_revenue);
      const pct = n(r.top_agency_share, r.agency_concentration, r.primary_agency_share) || (total > 0 ? top / total : 0);
      return total >= 500000 && pct >= 0.70;
    }
  },
  SUB_TO_PRIME_TRANSITION: {
    label: "Sub-to-Prime Transition",
    minScore: 65,
    predicate: r => {
      const sub = n(r.subcontract_revenue, r.federal_subcontract_revenue, r.sub_revenue);
      const prime = n(r.prime_revenue, r.federal_prime_revenue, r.prime_award_revenue);
      const subEvidence = b(r.has_subcontract_evidence, r.subcontractor, r.federal_subcontractor) || sub > 0;
      return subEvidence && sub >= 250000 && prime <= Math.max(100000, sub * 0.15);
    }
  },
  FEDERAL_BD_HIRING_INTENT: {
    label: "Federal BD Hiring Intent",
    minScore: 65,
    predicate: r => {
      const title = s(r.job_title, r.open_role_title, r.hiring_title);
      const intent = b(r.federal_bd_hiring, r.hiring_intent);
      const fresh = dateWithinDays(r.job_posted_date || r.signal_date || r.trigger_date, 120);
      return fresh && (intent || /(federal|government).*(business development|sales|capture|proposal|account executive)|capture manager|proposal manager/i.test(title));
    }
  },
  OPPORTUNITY_VEHICLE_GAP: {
    label: "Opportunity Vehicle Gap",
    minScore: 70,
    predicate: r => {
      const fit = n(r.opportunity_fit_score, r.fit_score, r.match_score);
      const value = n(r.addressable_value, r.opportunity_value, r.estimated_value);
      return fit >= 70 && value >= 250000 && b(r.missing_required_vehicle, r.vehicle_gap, r.access_gap);
    }
  },
  "8A_GRADUATION_24M": {
    label: "8(a) Graduation Within 24 Months",
    minScore: 65,
    predicate: r => {
      const days = n(r.days_to_8a_graduation, r.days_until_graduation);
      return b(r.is_8a, r.eight_a, r["8a"]) && days >= 0 && days <= 730;
    }
  },
  FEDERAL_WHITE_SPACE_EXPANSION: {
    label: "Federal White-Space Expansion",
    minScore: 65,
    predicate: r => {
      const revenue = n(r.federal_revenue, r.total_federal_revenue);
      const adjacent = n(r.adjacent_agency_fit_count, r.white_space_agency_count);
      return revenue >= 500000 && adjacent >= 1 && b(r.white_space_verified, r.adjacent_agency_opportunity);
    }
  },
  RECENT_RECOMPETE_LOSS: {
    label: "Recent Recompete Loss / Competitive Displacement",
    minScore: 70,
    predicate: r => {
      const lost = b(r.recompete_lost, r.incumbent_displaced, r.recent_contract_loss);
      return lost && dateWithinDays(r.loss_date || r.award_date || r.trigger_date, 365);
    }
  }
});

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
function b(...vals) {
  return vals.some(v => v === true || /^(1|true|yes|y)$/i.test(String(v || "").trim()));
}
function norm(v) { return s(v).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim(); }
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
function companyKey(r) {
  const uei = compact(r.uei || r.UEI || r.unique_entity_id);
  if (uei) return `UEI:${uei}`;
  const domain = norm(r.domain || r.website_domain || r.website || domainFromEmail(r.email || r.email_address));
  if (domain) return `DOMAIN:${domain}`;
  const name = compact(r.company_name || r.legal_name || r.business_name || r.recipient_name || r.name);
  if (name) return `NAME:${name}`;
  const email = s(r.email || r.email_address).toLowerCase();
  return email ? `EMAIL:${email}` : "";
}

function parseCsvLine(line) {
  const out=[]; let cur=""; let quoted=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch === '"') {
      if (quoted && line[i+1] === '"') { cur += '"'; i++; }
      else quoted=!quoted;
    } else if (ch === "," && !quoted) { out.push(cur); cur=""; }
    else cur += ch;
  }
  out.push(cur); return out;
}
function readCsv(file) {
  const text=fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"");
  const lines=text.split(/\r?\n/).filter(x=>x.trim());
  if (lines.length<2) return [];
  const headers=parseCsvLine(lines[0]).map(x=>x.trim());
  return lines.slice(1).map(line=>{
    const vals=parseCsvLine(line); const r={};
    headers.forEach((h,i)=>r[h]=vals[i]??"");
    return r;
  });
}
function readJsonRows(file) {
  const raw=JSON.parse(fs.readFileSync(file,"utf8"));
  if (Array.isArray(raw)) return raw;
  for (const k of ["rows","records","companies","awards","data","results","leads"]) if (Array.isArray(raw[k])) return raw[k];
  return [];
}
function readRows(file) {
  if (!fs.existsSync(file)) return [];
  if (/\.csv$/i.test(file)) return readCsv(file);
  if (/\.json$/i.test(file)) return readJsonRows(file);
  return [];
}
function walk(root, maxDepth=5) {
  const out=[];
  function go(dir, depth) {
    if (depth>maxDepth || !fs.existsSync(dir)) return;
    let entries=[]; try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return; }
    for (const e of entries) {
      const full=path.join(dir,e.name);
      if (e.isDirectory()) {
        if (!/node_modules|\.git|backup|archive|queue/i.test(full)) go(full,depth+1);
      } else if (/\.(csv|json)$/i.test(e.name)) out.push(full);
    }
  }
  go(root,0); return out;
}
function csvEscape(v) {
  const x=String(v??"");
  return /[",\r\n]/.test(x) ? `"${x.replace(/"/g,'""')}"` : x;
}
function writeCsv(file, rows, headers) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,[headers.join(","),...rows.map(r=>headers.map(h=>csvEscape(r[h])).join(","))].join("\n"),"utf8");
}

class MonicaAcquisitionIntelligenceService {
  constructor(options={}) {
    this.root=options.rootDir || DEFAULT_ROOT;
    this.configPath=options.configPath || path.join(this.root,"CONFIG","MONICA","monica_acquisition_config.json");
    this.outputDir=options.outputDir || path.join(this.root,"DATA","MONICA","NET_NEW_ACQUISITION_SEGMENT_CENSUS");
  }

  loadConfig() {
    const defaults={
      mode:"DISCOVERY_ONLY",
      activationBlocked:true,
      candidateRoots:[
        path.join(this.root,"DATA"),
        "D:\\P2GC_Intelligence\\ORION_CORE",
        "D:\\P2GC_Intelligence\\MILES_ENTERPRISE\\DATA"
      ],
      suppressionRoots:[
        path.join(this.root,"DATA","OUTBOUND"),
        path.join(this.root,"DATA","marketing_coo"),
        "D:\\P2GC_Intelligence\\MILES_ENTERPRISE\\DATA\\OUTBOUND"
      ],
      candidatePatterns:["award","recompete","revenue","incumbent","vehicle","hiring","capture","subcontract","agency","orion"],
      suppressionPatterns:["MASTER_DEDUPED_ALL_SEGMENTS","instantly","segment","lead","campaign"],
      minNetNewForBuildTest:250
    };
    if (!fs.existsSync(this.configPath)) return defaults;
    return {...defaults,...JSON.parse(fs.readFileSync(this.configPath,"utf8"))};
  }

  discover(patterns, roots) {
    const re=new RegExp(patterns.join("|"),"i");
    const files=[];
    for (const root of roots) for (const file of walk(root,5)) if (re.test(path.basename(file)) || re.test(file)) files.push(file);
    return [...new Set(files)];
  }

  buildSuppressionIndex(files) {
    const keys=new Set(), emails=new Set(), sources=new Map();
    for (const file of files) {
      let rows=[]; try { rows=readRows(file); } catch { continue; }
      for (const r of rows) {
        const key=companyKey(r);
        const email=s(r.email,r.email_address,r.contact_email).toLowerCase();
        if (key) { keys.add(key); if (!sources.has(key)) sources.set(key,[]); sources.get(key).push(file); }
        if (email) emails.add(email);
      }
    }
    return {keys,emails,sources};
  }

  qualifyRow(row, sourceFile, suppression) {
    const key=companyKey(row);
    if (!key) return [];
    const email=s(row.email,row.email_address,row.contact_email).toLowerCase();
    const overlap=suppression.keys.has(key) || (email && suppression.emails.has(email));
    const qualified=[];
    for (const [segment,def] of Object.entries(SEGMENTS)) {
      let ok=false; try { ok=def.predicate(row); } catch { ok=false; }
      if (!ok) continue;
      const score=this.score(row,segment);
      if (score < def.minScore) continue;
      qualified.push({
        segment,
        segment_label:def.label,
        company_key:key,
        company_name:s(row.company_name,row.legal_name,row.business_name,row.recipient_name,row.name),
        uei:s(row.uei,row.UEI,row.unique_entity_id),
        domain:norm(row.domain||row.website_domain||row.website||domainFromEmail(email)),
        decision_maker:s(row.contact_name,row.decision_maker,row.poc_name),
        title:s(row.title,row.contact_title,row.job_title),
        email,
        phone:s(row.phone,row.phone_number),
        agency:s(row.agency,row.awarding_agency,row.top_agency,row.primary_agency),
        contract:s(row.contract_number,row.award_id,row.piid,row.contract_id),
        estimated_federal_revenue:n(row.total_federal_revenue,row.federal_revenue,row.current_ttm_federal_revenue),
        trigger_date:s(row.trigger_date,row.loss_date,row.job_posted_date,row.award_date,row.recompete_date),
        qualification_reason:this.reason(row,segment),
        evidence_source:sourceFile,
        overlap_existing:overlap ? "YES":"NO",
        net_new:overlap ? "NO":"YES",
        score
      });
    }
    return qualified;
  }

  score(row, segment) {
    let score=50;
    if (s(row.uei,row.UEI,row.unique_entity_id)) score+=10;
    if (norm(row.domain||row.website_domain||row.website||domainFromEmail(row.email||row.email_address))) score+=5;
    if (s(row.email,row.email_address,row.contact_email)) score+=5;
    if (s(row.agency,row.awarding_agency,row.top_agency)) score+=5;
    if (s(row.contract_number,row.award_id,row.piid)) score+=5;
    if (s(row.trigger_date,row.loss_date,row.job_posted_date,row.award_date,row.recompete_date)) score+=5;
    if (n(row.total_federal_revenue,row.federal_revenue,row.contract_value,row.award_amount)>0) score+=10;
    if (segment==="FEDERAL_BD_HIRING_INTENT" && s(row.job_url,row.source_url)) score+=5;
    return Math.min(100,score);
  }

  reason(r, segment) {
    switch(segment) {
      case "RECOMPETE_REVENUE_AT_RISK": return `Incumbent with recompete within ${n(r.days_to_recompete,r.days_until_recompete,r.recompete_days)} days and material award value.`;
      case "FEDERAL_REVENUE_DECLINE": return `Federal revenue declined from ${n(r.prior_ttm_federal_revenue,r.prior_year_federal_revenue,r.previous_federal_revenue)} to ${n(r.current_ttm_federal_revenue,r.current_year_federal_revenue,r.federal_revenue)}.`;
      case "FEDERAL_AGENCY_CONCENTRATION": return "Material federal revenue with at least 70% concentrated in one agency.";
      case "SUB_TO_PRIME_TRANSITION": return "Material federal subcontract performance with limited prime award revenue.";
      case "FEDERAL_BD_HIRING_INTENT": return "Recent hiring signal for federal sales, capture, proposal, or business development.";
      case "OPPORTUNITY_VEHICLE_GAP": return "Strong opportunity fit with material addressable value but missing required vehicle/access path.";
      case "8A_GRADUATION_24M": return "8(a) participant approaching graduation within 24 months.";
      case "FEDERAL_WHITE_SPACE_EXPANSION": return "Established federal contractor with verified adjacent-agency whitespace.";
      case "RECENT_RECOMPETE_LOSS": return "Recent recompete loss or incumbent displacement signal.";
      default:return segment;
    }
  }

  run() {
    const config=this.loadConfig();
    if (config.mode!=="DISCOVERY_ONLY" || config.activationBlocked!==true) throw new Error("MONICA_SAFETY_GATE_REQUIRES_DISCOVERY_ONLY");

    const candidateFiles=this.discover(config.candidatePatterns,config.candidateRoots);
    const suppressionFiles=this.discover(config.suppressionPatterns,config.suppressionRoots);
    const suppression=this.buildSuppressionIndex(suppressionFiles);

    const dedupe=new Map();
    for (const file of candidateFiles) {
      let rows=[]; try { rows=readRows(file); } catch { continue; }
      for (const row of rows) {
        for (const q of this.qualifyRow(row,file,suppression)) {
          const id=`${q.segment}|${q.company_key}`;
          const prev=dedupe.get(id);
          if (!prev || q.score>prev.score) dedupe.set(id,q);
        }
      }
    }
    const rows=[...dedupe.values()].sort((a,b)=>a.segment.localeCompare(b.segment)||b.score-a.score);
    const summary=Object.entries(SEGMENTS).map(([segment,def])=>{
      const all=rows.filter(r=>r.segment===segment);
      const net=all.filter(r=>r.net_new==="YES");
      const withEmail=net.filter(r=>r.email);
      const recommendation=net.length>=config.minNetNewForBuildTest ? "TEST" : (net.length>=50 ? "NURTURE":"HOLD");
      return {
        segment,
        label:def.label,
        raw_qualified_companies:all.length,
        existing_overlap:all.length-net.length,
        true_net_new_companies:net.length,
        net_new_contacts_with_email:withEmail.length,
        recommendation
      };
    });

    fs.mkdirSync(this.outputDir,{recursive:true});
    const headers=["segment","segment_label","company_key","company_name","uei","domain","decision_maker","title","email","phone","agency","contract","estimated_federal_revenue","trigger_date","qualification_reason","evidence_source","overlap_existing","net_new","score"];
    writeCsv(path.join(this.outputDir,"MONICA_NET_NEW_LEADS.csv"),rows,headers);
    writeCsv(path.join(this.outputDir,"MONICA_SEGMENT_CENSUS.csv"),summary,Object.keys(summary[0]));
    fs.writeFileSync(path.join(this.outputDir,"MONICA_SEGMENT_CENSUS.json"),JSON.stringify({
      generatedAt:new Date().toISOString(),
      mode:config.mode,
      activationBlocked:config.activationBlocked,
      candidateFiles,
      suppressionFiles,
      suppressionCompanyKeys:suppression.keys.size,
      suppressionEmails:suppression.emails.size,
      summary
    },null,2),"utf8");

    return {ok:true,outputDir:this.outputDir,candidateFiles:candidateFiles.length,suppressionFiles:suppressionFiles.length,summary};
  }
}

module.exports={MonicaAcquisitionIntelligenceService,SEGMENTS,companyKey};
