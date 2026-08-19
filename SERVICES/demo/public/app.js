"use strict";

let current = null;
const $ = id => document.getElementById(id);
const money = value => value == null ? "Unavailable" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)||0);
const esc = value => String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
const unavailable = text => `<div class="empty">${esc(text || "Not available from current evidence.")}</div>`;
const yesNo = value => value === true ? "Yes" : value === false ? "No" : "Unavailable";

function rows(items, formatter) {
  return (items || []).length ? items.map(formatter).join("") : unavailable();
}
function bullets(items) {
  return (items || []).length ? `<ul>${items.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : unavailable();
}
function statusPill(text) { return `<span class="pill">${esc(text || "UNAVAILABLE")}</span>`; }

function renderProfile(p) {
  $("companyName").textContent = p.companyName || "Unknown company";
  const fields = [
    ["UEI",p.uei],["CAGE",p.cage],["Headquarters",p.headquarters],["Website",p.website],
    ["NAICS",(p.naicsCodes||[]).join(", ")],["Certifications",(p.certifications||[]).join(", ")],
    ["SAM",p.samStatus],["GSA",p.gsaStatus],["Contract Vehicles",(p.contractVehicles||[]).join(", ")],
    ["Years in Business",p.yearsInBusiness]
  ];
  $("profileMeta").innerHTML = fields.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value == null || value === "" ? "Unavailable" : value)}</strong></div>`).join("");
}

function renderReadiness(r) {
  $("overallScore").textContent = `${r.overall}/100`;
  $("scoreMethod").textContent = r.methodology || "";
  $("readinessGrid").innerHTML = Object.values(r.categories||{}).map(c=>`
    <article class="score-card">
      <div class="score-card-head"><strong>${esc(c.label)}</strong><b>${c.score}%</b></div>
      <div class="bar"><span style="width:${Math.max(0,Math.min(100,c.score))}%"></span></div>
      <details><summary>Why this score</summary>
        <div class="evidence good"><b>Evidence:</b>${(c.evidence||[]).length?`<ul>${c.evidence.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:" None identified"}</div>
        <div class="evidence miss"><b>Missing:</b>${(c.missing||[]).length?`<ul>${c.missing.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:" None"}</div>
      </details>
    </article>`).join("");
}

function renderState(m) {
  const s=m.currentState||{};
  $("currentState").innerHTML = `<ul class="check-list">
    <li><b>SAM registration:</b> ${yesNo(s.samRegistration)}</li>
    <li><b>SBA / socioeconomic certifications:</b> ${esc((s.certifications||[]).join(", ")||"None identified")}</li>
    <li><b>Contract vehicles:</b> ${esc((s.contractVehicles||[]).join(", ")||"None identified")}</li>
    <li><b>Federal awards:</b> ${esc(s.activeContracts ?? "Unavailable")}</li>
    <li><b>Federal sales:</b> ${money(s.federalSales)}</li>
    <li><b>State/local sales:</b> ${money(s.stateLocalSales)}</li>
    <li><b>Agency relationships:</b> ${esc((s.agencyRelationships||[]).join(", ")||"None identified")}</li>
  </ul>`;
  $("gaps").innerHTML = bullets(m.gaps?.items||[]);
}

function renderRevenue(r) {
  $("revenueStatus").textContent = r.opportunity?.status || "UNAVAILABLE";
  const c=r.current||{}, o=r.opportunity||{};
  const metrics = [
    ["Current Federal Revenue",money(c.federal)],
    ["State Revenue",money(c.state)],
    ["Local Revenue",money(c.local)],
    ["Commercial Revenue",money(c.commercial)],
    ["Modeled Potential Federal Revenue",money(o.modeledPotentialFederalRevenue)],
    ["Modeled Growth Opportunity",money(o.modeledGrowthOpportunity)]
  ];
  $("revenueCards").innerHTML = metrics.map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
  $("revenueDisclosure").textContent = o.disclosure || "";
}

function renderVehicles(v) {
  $("vehicles").innerHTML = `<h3>Current Vehicles</h3>${bullets(v.current||[])}<h3>Optimization / Missing Vehicle Actions</h3>${bullets(v.recommendations||[])}`;
}
function renderAgencies(a) {
  $("agencies").innerHTML = (a.agencies||[]).length ? a.agencies.map(x=>`
    <div class="agency-row"><div><strong>${esc(x.agency)}</strong><span>${esc(x.basis||"")}</span></div><b>${esc(x.fitScore)}%</b></div>`).join("") : unavailable("No agency alignment available from current buyer history.");
}

function renderCompetitors(c) {
  $("competitors").innerHTML = (c.records||[]).length ? `<table><thead><tr><th>Company</th><th>Federal Revenue</th><th>Awards</th><th>Vehicle</th><th>Agencies</th></tr></thead><tbody>${c.records.map(x=>`<tr><td>${esc(x.company)}</td><td>${money(x.federalRevenue)}</td><td>${esc(x.awardCount??"—")}</td><td>${esc(x.vehicle||"Unavailable")}</td><td>${esc((x.agencies||[]).join(", ")||"Unavailable")}</td></tr>`).join("")}</tbody></table>` : unavailable("No defensible competitor candidates were identified from the current ORION peer model.");
  $("competitorDisclosure").textContent = c.disclosure || "";
}
function renderPrimes(p) {
  $("primes").innerHTML = rows(p.records||[],x=>`<div class="partner"><strong>${esc(x.company)}</strong><span>Vehicle: ${esc(x.vehicle||"Unavailable")}</span><span>Federal revenue: ${money(x.federalRevenue)}</span><span>Agencies: ${esc((x.agencies||[]).join(", ")||"Unavailable")}</span></div>`) + `<h3>Teaming Strategy</h3>${bullets(p.strategy||[])}`;
}
function renderSubs(s) {
  $("subcontracting").innerHTML = `${statusPill(s.status)}${rows(s.records||[],x=>`<div class="opportunity"><strong>${esc(x.title)}</strong><span>${esc(x.source||"")}</span></div>`)}<h3>Recommended Partner Actions</h3>${bullets(s.strategy||[])}`;
}
function renderBuyers(b) {
  $("buyers").innerHTML = (b.records||[]).length ? `<table><thead><tr><th>Agency</th><th>Buyer / Office</th><th>Historical Spend</th><th>Awards</th></tr></thead><tbody>${b.records.map(x=>`<tr><td>${esc(x.agency||"Unavailable")}</td><td>${esc(x.buyer||"Unavailable")}</td><td>${money(x.spend)}</td><td>${esc(x.awardCount??"—")}</td></tr>`).join("")}</tbody></table>` : unavailable("No linked buyer history is available.");
}
function renderOpportunities(o) {
  $("opportunities").innerHTML = rows(o.liveAndForecast||[],x=>`<div class="opportunity"><strong>${esc(x.title||"Untitled")}</strong><span>${esc(x.source||"Source unavailable")}${x.dueDate?` • Due ${esc(x.dueDate)}`:""}</span></div>`);
  $("recompetes").innerHTML = rows(o.recompetes||[],x=>`<div class="opportunity"><strong>${esc(x.title||"Untitled")}</strong><span>${esc(x.agency||"Agency unavailable")}${x.date?` • ${esc(x.date)}`:""}${x.value?` • ${money(x.value)}`:""}</span><small>${esc(x.qualification||"")}</small></div>`);
}
function renderPathway(p) {
  $("pathwayTitle").textContent=p.title||"Growth Pathway™";
  $("pathway").innerHTML=(p.steps||[]).map((x,i)=>`<div class="path-step"><b>Step ${i+1}</b><span>${esc(x)}</span></div>`).join('<div class="arrow">↓</div>');
}
function renderRecommendations(r) {
  const groups=[["Immediate Actions",r.immediate],["Vehicle Strategy",r.vehicle],["Agency Strategy",r.agency],["Prime / Partner Strategy",r.partner],["Opportunity Strategy",r.opportunity],["Growth Strategy",r.growth]];
  $("recommendations").innerHTML=groups.map(([title,items])=>`<div class="rec-group"><h3>${esc(title)}</h3>${bullets(items||[])}</div>`).join("");
}

function render(m) {
  current=m;
  renderProfile(m.profile||{}); renderReadiness(m.readiness||{}); renderState(m); renderRevenue(m.revenue||{});
  renderVehicles(m.vehicles||{}); renderAgencies(m.agencyAlignment||{}); renderCompetitors(m.competitors||{});
  renderPrimes(m.primePartners||{}); renderSubs(m.subcontracting||{}); renderBuyers(m.buyerIntelligence||{});
  renderOpportunities(m.opportunities||{}); renderPathway(m.pathway||{}); renderRecommendations(m.recommendations||{});
  $("generatedAt").textContent=`Generated ${new Date(m.generatedAt).toLocaleString()}`;
  $("welcome").classList.add("hidden"); $("report").classList.remove("hidden"); $("refresh").disabled=false; $("print").disabled=false; $("download").disabled=false;
}

async function analyze(refresh=false) {
  const term=$("term").value.trim(); if(!term){$("term").focus();return;}
  $("loading").classList.remove("hidden"); $("error").classList.add("hidden"); $("analyze").disabled=true; $("refresh").disabled=true;
  try {
    const res=await fetch(`/api/assessment?term=${encodeURIComponent(term)}${refresh?"&refresh=1":""}`,{cache:"no-store"});
    const data=await res.json(); if(!res.ok||!data.ok) throw new Error(data.message||data.error||data.status||"Assessment failed"); render(data);
  } catch(error) { $("error").textContent=error.message; $("error").classList.remove("hidden"); }
  finally { $("loading").classList.add("hidden"); $("analyze").disabled=false; $("refresh").disabled=current?false:true; }
}

$("analyze").addEventListener("click",()=>analyze(false));
$("refresh").addEventListener("click",()=>analyze(true));
$("print").addEventListener("click",()=>window.print());
$("download").addEventListener("click",()=>{ if(current){ window.location.href=`/api/blueprint?term=${encodeURIComponent(current.profile?.uei||current.profile?.companyName)}&format=md`; } });
$("term").addEventListener("keydown",e=>{ if(e.key==="Enter") analyze(false); });
