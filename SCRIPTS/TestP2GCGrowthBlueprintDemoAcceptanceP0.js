"use strict";

const orion = require("../CONNECTORS/ORION/connector");
const BASE = process.env.P2GC_GROWTH_DEMO_URL || "http://127.0.0.1:8791";
const checks = [];

function check(name, ok, detail = null) {
  checks.push({ name, ok:Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}
function norm(v){return String(v||"").trim().toUpperCase().replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();}
function synthetic(row={}){return /build[ _-]?e010|test company|example\.com|unknown target|not applicable/i.test([row.company,row.uei].filter(Boolean).join(" "));}
async function request(url){const controller=new AbortController();const t=setTimeout(()=>controller.abort(),120000);try{const r=await fetch(url,{signal:controller.signal,cache:"no-store"});const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}return{status:r.status,ok:r.ok,text,json,headers:r.headers};}finally{clearTimeout(t);}}

(async()=>{
  const init=orion.initialize();
  check("ORION available read-only",init?.ok===true,init?.db||init?.message||null);
  if(!init?.ok) throw new Error("ORION unavailable");
  const contractors=orion.getContractors(500,0).filter(x=>x&&x.company&&x.uei&&!synthetic(x));
  const preferred=["SERA BRYNN","K & K CONSTRUCTION SUPPLY INC","K K CONSTRUCTION SUPPLY INC"];
  const selected=preferred.map(n=>contractors.find(x=>norm(x.company)===norm(n))).find(Boolean)||contractors[0];
  check("real prospect selected",Boolean(selected),selected?`${selected.company} | ${selected.uei}`:"none");
  if(!selected) throw new Error("No real contractor available");

  const health=await request(`${BASE}/api/health`);
  check("standalone demo health",health.status===200&&health.json?.status==="HEALTHY",`http=${health.status}`);
  const page=await request(`${BASE}/`);
  check("screen-share page reachable",page.status===200&&/Executive Government Growth Blueprint/i.test(page.text),`http=${page.status}`);
  check("screen-share input supports company identifiers",/Company name, UEI, CAGE, or website/i.test(page.text),null);
  check("page is prospect-facing not MILES operations",!/Worker RAM|Department Health|TaskQueue|PM2/i.test(page.text),null);

  const term=encodeURIComponent(selected.uei);
  const response=await request(`${BASE}/api/assessment?term=${term}&refresh=1`);
  const m=response.json||{};
  check("real company assessment succeeds",response.status===200&&m.ok===true,`http=${response.status} status=${m.status||""}`);
  check("identity matches selected contractor",norm(m.profile?.uei)===norm(selected.uei),m.profile?.uei||null);
  check("opening profile has required fields",["companyName","uei","cage","headquarters","website","naicsCodes","certifications","samStatus","gsaStatus","contractVehicles","yearsInBusiness"].every(k=>Object.prototype.hasOwnProperty.call(m.profile||{},k)),null);
  check("readiness has seven categories",Object.keys(m.readiness?.categories||{}).length===7,Object.keys(m.readiness?.categories||{}).join(","));
  check("readiness overall is 0-100",Number.isFinite(Number(m.readiness?.overall))&&Number(m.readiness.overall)>=0&&Number(m.readiness.overall)<=100,String(m.readiness?.overall));
  check("every readiness score is explainable",Object.values(m.readiness?.categories||{}).every(x=>Array.isArray(x.evidence)&&Array.isArray(x.missing)&&Array.isArray(x.checks)),null);
  check("current-state dashboard present",Boolean(m.currentState&&Object.prototype.hasOwnProperty.call(m.currentState,"federalSales")),null);
  check("gap analysis present",Array.isArray(m.gaps?.items),`gaps=${m.gaps?.items?.length||0}`);
  check("revenue dashboard distinguishes modeled opportunity",Boolean(m.revenue?.opportunity?.status&&m.revenue?.opportunity?.disclosure),m.revenue?.opportunity?.status||null);
  check("vehicle dashboard present",Array.isArray(m.vehicles?.current)&&Array.isArray(m.vehicles?.recommendations),null);
  check("competitor intelligence labeled model/unavailable",/MODEL|UNAVAILABLE/i.test(String(m.competitors?.status||"")),m.competitors?.status||null);
  check("prime intelligence labeled model/unavailable",/MODEL|UNAVAILABLE/i.test(String(m.primePartners?.status||"")),m.primePartners?.status||null);
  check("agency alignment has model status",/MODEL|UNAVAILABLE/i.test(String(m.agencyAlignment?.status||"")),m.agencyAlignment?.status||null);
  check("buyer intelligence present",Array.isArray(m.buyerIntelligence?.records),`buyers=${m.buyerIntelligence?.records?.length||0}`);
  check("opportunity dashboard present",Array.isArray(m.opportunities?.liveAndForecast)&&Array.isArray(m.opportunities?.recompetes),null);
  check("pathway is first-award or growth",["FIRST_AWARD_PATHWAY","GROWTH_PATHWAY"].includes(m.pathway?.type),m.pathway?.type||null);
  check("pathway has seven steps",Array.isArray(m.pathway?.steps)&&m.pathway.steps.length===7,`steps=${m.pathway?.steps?.length||0}`);
  check("ORION immediate recommendations present as array",Array.isArray(m.recommendations?.immediate),`count=${m.recommendations?.immediate?.length||0}`);
  check("demo is read-only",m.safety?.readOnly===true&&m.safety?.writesEnabled===false&&m.safety?.emailsSent===false&&m.safety?.campaignsChanged===false,null);
  check("no internal runtime metrics leaked",!/worker_memory|TaskQueue|PM2|lockPath|matchedContractorId/i.test(JSON.stringify(m)),null);
  check("evidence disclosure distinguishes modeled facts",/modeled|unavailable/i.test(String(m.evidence?.disclosure||"")),null);

  const cached=await request(`${BASE}/api/assessment?term=${term}`);
  check("repeat assessment uses cache",cached.status===200&&cached.json?.cache?.hit===true,`cache=${cached.json?.cache?.hit}`);
  const md=await request(`${BASE}/api/blueprint?term=${term}&format=md`);
  check("Executive Growth Blueprint export works",md.status===200&&/Executive Government Growth Blueprint/i.test(md.text),`http=${md.status}`);
  check("blueprint export contains same company",md.text.includes(m.profile.companyName)||md.text.includes(m.profile.uei),m.profile.companyName);
  check("blueprint contains 90-day plan",/90-Day Action Plan/i.test(md.text),null);
  check("blueprint contains 12-month plan",/12-Month Growth Plan/i.test(md.text),null);

  const report={ok:checks.every(x=>x.ok),generatedAt:new Date().toISOString(),prospect:{company:selected.company,uei:selected.uei},checks};
  console.log(`=== P2GC GROWTH BLUEPRINT DEMO ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);
  try{orion.shutdown()}catch{}
  process.exitCode=report.ok?0:1;
})().catch(error=>{console.error(error.stack||error.message);try{orion.shutdown()}catch{}process.exit(1);});
