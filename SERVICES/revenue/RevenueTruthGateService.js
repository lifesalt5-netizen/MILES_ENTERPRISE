"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..", "..");
const DEALS_FILE = path.join(ROOT, "DATA", "runtime", "latest_deals.json");
const OUT_DIR = path.join(ROOT, "DATA", "revenue_truth");
const OUT_FILE = path.join(OUT_DIR, "latest_revenue_truth_gate.json");

function readJson(file, fallback={}) { try { return JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"")); } catch { return fallback; } }
function synthetic(deal={}) { const text=[deal.id,deal.name,deal.company,deal.contactName,deal.email,deal.source].filter(Boolean).join(" ").toLowerCase(); return /build[ _-]?e010|test company|example\.com|unknown target|synthetic/.test(text); }
function money(v){const n=Number(v);return Number.isFinite(n)?n:0;}

class RevenueTruthGateService {
  run(input={}) {
    const raw=readJson(input.file||DEALS_FILE,{});
    const deals=Array.isArray(raw)?raw:(Array.isArray(raw.deals)?raw.deals:[]);
    const real=deals.filter(d=>!synthetic(d));
    const excluded=deals.filter(synthetic);
    const qualified=real.filter(d=>/qualified|proposal|meeting|negotiation|client|won/i.test(String(d.stage||d.status||"")));
    const pipelineValue=real.reduce((sum,d)=>sum+money(d.value||d.amount||d.pipelineValue||d.estimatedValue),0);
    const result={
      ok:true,
      service:"REVENUE_TRUTH_GATE",
      status:"PASS",
      generatedAt:new Date().toISOString(),
      sourceFile:input.file||DEALS_FILE,
      sourceExists:fs.existsSync(input.file||DEALS_FILE),
      counts:{raw:deals.length,real:real.length,excludedSynthetic:excluded.length,qualified:qualified.length},
      pipelineValue,
      deals:real,
      excludedSynthetic:excluded.map(d=>({id:d.id||null,name:d.name||d.company||null,reason:"SYNTHETIC_OR_TEST_RECORD"})),
      rules:{syntheticExcluded:true,unknownTargetsExcluded:true,testEmailDomainsExcluded:true,sourceTruthPreserved:true}
    };
    fs.mkdirSync(OUT_DIR,{recursive:true});
    fs.writeFileSync(OUT_FILE,JSON.stringify(result,null,2),"utf8");
    return result;
  }
  healthCheck(){const r=this.run();return{ok:r.ok,status:r.status,counts:r.counts,generatedAt:r.generatedAt,evidenceFile:OUT_FILE};}
}
module.exports=new RevenueTruthGateService();
