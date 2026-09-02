"use strict";

let current = null;
const $ = id => document.getElementById(id);
const moneyFormatter = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
const money = value => {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const n = Number(value);
  return Number.isFinite(n) ? moneyFormatter.format(n) : "Unavailable";
};
const esc = value => String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
const unavailable = text => `<div class="empty">${esc(text || "Not available from current evidence.")}</div>`;
const yesNo = value => value === true ? "Yes" : value === false ? "No" : "Unavailable";
const safeUrl = value => { try { const u=new URL(String(value||"")); return /^https?:$/.test(u.protocol)?u.toString():null; } catch { return null; } };

function rows(items, formatter) { return (items || []).length ? items.map(formatter).join("") : unavailable(); }
function bullets(items) { return (items || []).length ? `<ul>${items.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>` : unavailable(); }
function statusPill(text) { return `<span class="pill">${esc(text || "UNAVAILABLE")}</span>`; }
function preview(name, fallbackRecords=[]) {
  const p=current?.commercialPreview?.[name];
  return p || { visible:fallbackRecords, visibleCount:(fallbackRecords||[]).length, lockedCount:0, totalKnown:(fallbackRecords||[]).length };
}
function locked(count, label) {
  if (!count) return "";
  return Array.from({length:count},(_,i)=>`<div class="locked-result"><div class="lock-icon">🔒</div><div><strong>${esc(label)} ${i+1}</strong><span>Additional company-specific intelligence available with P2GC.</span></div></div>`).join("");
}
function unlockNote(count) {
  return count ? `<div class="unlock-note"><strong>${count} additional verified/modeled result${count===1?"":"s"} available.</strong><span>${esc(current?.commercialPreview?.cta||"Unlock the full company-specific growth intelligence with P2GC.")}</span></div>` : "";
}
function evidenceList(values, status) {
  const items=(values||[]).filter(Boolean);
  if(items.length) return items.join(", ");
  const s=String(status||"").toUpperCase();
  if(/CONFIRMED_NONE|CONFIRMED_NO_/.test(s)) return "None confirmed by current source";
  return "Unavailable / not confirmed";
}

function renderProfile(p) {
  $("companyName").textContent = p.companyName || "Unknown company";
  const gsaContracts=(p.gsaContracts||[]).map(x=>x.contractNumber).filter(Boolean).join(", ");
  const fields = [
    ["UEI",p.uei],["CAGE",p.cage],["Headquarters",p.headquarters],["Website",p.website],
    ["NAICS",(p.naicsCodes||[]).join(", ")],["Certifications",evidenceList(p.certifications,p.certificationsStatus)],
    ["SAM",p.samStatus],["GSA",p.gsaStatus],["GSA Contract(s)",gsaContracts],
    ["Contract Vehicles",evidenceList(p.contractVehicles,p.gsaEvidenceStatus)],["Years in Business",p.yearsInBusiness]
  ];
  $("profileMeta").innerHTML = fields.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value == null || value === "" ? "Unavailable" : value)}</strong></div>`).join("");
}
function renderReadiness(r) {
  $("overallScore").textContent = `${r.overall}/100`;
  $("scoreMethod").textContent = r.methodology || "";
  $("readinessGrid").innerHTML = Object.values(r.categories||{}).map(c=>`<article class="score-card"><div class="score-card-head"><strong>${esc(c.label)}</strong><b>${c.score}%</b></div><div class="bar"><span style="width:${Math.max(0,Math.min(100,c.score))}%"></span></div><details><summary>Why this score</summary><div class="evidence good"><b>Evidence:</b>${(c.evidence||[]).length?`<ul>${c.evidence.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:" None identified"}</div><div class="evidence miss"><b>Missing:</b>${(c.missing||[]).length?`<ul>${c.missing.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:" None"}</div></details></article>`).join("");
}
function renderState(m) {
  const s=m.currentState||{};
  const awardLabel=s.activeContractsLabel||"Active federal contracts";
  $("currentState").innerHTML = `<ul class="check-list">
    <li><b>SAM registration:</b> ${yesNo(s.samRegistration)}</li>
    <li><b>SBA / socioeconomic certifications:</b> ${esc(evidenceList(s.certifications,s.certificationsStatus))}</li>
    <li><b>Contract vehicles:</b> ${esc(evidenceList(s.contractVehicles,s.contractVehiclesStatus||m.profile?.gsaEvidenceStatus))}</li>
    <li><b>Federal awards:</b> ${esc(s.awardCount ?? "Unavailable")}</li>
    <li><b>${esc(awardLabel)}:</b> ${esc(s.activeContracts ?? "Unavailable")}</li>
    <li><b>Federal obligations / sales evidence:</b> ${money(s.federalSales)}</li>
    <li><b>State/local sales:</b> ${money(s.stateLocalSales)}</li>
    <li><b>Agency relationships:</b> ${esc(evidenceList(s.agencyRelationships,s.agencyRelationshipsStatus))}</li>
  </ul>`;
  $("gaps").innerHTML = bullets(m.gaps?.items||[]);
}
function renderRevenue(r) {
  $("revenueStatus").textContent = r.opportunity?.status || r.current?.federalStatus || "UNAVAILABLE";
  const c=r.current||{}, o=r.opportunity||{};
  const federalLabel=/OBLIGATION/i.test(String(c.federalStatus||"")) ? "Verified Federal Obligations (Current Measurement Window)" : "Current Federal Revenue / Obligations";
  const metrics=[[federalLabel,money(c.federal)],["State Revenue",money(c.state)],["Local Revenue",money(c.local)],["Commercial Revenue",money(c.commercial)],["Modeled Potential Federal Revenue",money(o.modeledPotentialFederalRevenue)],["Modeled Growth Opportunity",money(o.modeledGrowthOpportunity)]];
  $("revenueCards").innerHTML=metrics.map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
  const window=c.measurementWindow?` Measurement window: ${c.measurementWindow.startDate||"?"} through ${c.measurementWindow.endDate||"?"}.`:"";
  $("revenueDisclosure").textContent=`${c.federalDefinition||""}${window} ${o.disclosure||""}`.trim();
}
function renderAwards(a) {
  const summary=a?.summary||{};
  $("awardStatus").textContent=a?.status||"UNAVAILABLE";
  $("awardSummary").innerHTML=[
    ["Distinct Federal Awards",summary.awardCount],["Prime Awards",summary.primeAwardCount],["Subcontract Awards",summary.subcontractAwardCount],
    ["Reported Prime Award Value",summary.primeAwardedRevenue==null?"Unavailable":money(summary.primeAwardedRevenue)],
    ["Reported Subcontract Award Value",summary.subcontractedRevenue==null?"Unavailable":money(summary.subcontractedRevenue)],
    ["Prime Awards in Current Performance Period",summary.activePrimeAwardCount]
  ].map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value==null?"Unavailable":value)}</strong></div>`).join("");
  const records=[...(a?.primeAwards||[]),...(a?.subcontracts||[])];
  const visible=records.slice(0,5), remainder=Math.max(0,records.length-visible.length);
  $("awardHistory").innerHTML=visible.length?`<table><thead><tr><th>Role</th><th>Award</th><th>Agency</th><th>Value</th><th>Period / Date</th></tr></thead><tbody>${visible.map(x=>`<tr><td>${esc(x.role||"—")}</td><td>${esc(x.awardId||"—")}</td><td>${esc(x.awardingAgency||"Unavailable")}</td><td>${money(x.amount)}</td><td>${esc([x.startDate,x.endDate].filter(Boolean).join(" → ")||x.actionDate||"Unavailable")}</td></tr>`).join("")}</tbody></table>${locked(remainder,"Additional confirmed award")}${unlockNote(remainder)}`:unavailable(a?.truthClass==="CONFIRMED"?"Authoritative lookup confirmed no federal prime/subcontract award history for this identity.":"Authoritative award history is not currently available; no zero-award claim is made.");
  $("awardDisclosure").textContent=summary.awardedValueDefinition||"Award values are shown separately from realized federal obligations/sales evidence.";
}
function renderVehicles(v) {
  const p=preview("vehicles",v.current||[]);
  const details=(v.details||[]).map(x=>`<div class="partner"><strong>${esc(x.contractNumber||"GSA MAS contract")}</strong><span>Current option end: ${esc(x.currentOptionPeriodEndDate||"Unavailable")}</span><span>Ultimate end: ${esc(x.ultimateContractEndDate||"Unavailable")}</span><span>Categories: ${esc((x.categories||[]).join(", ")||"Unavailable")}</span><span>Socioeconomic: ${esc(x.socioEconomicIndicators||"Unavailable")}</span></div>`).join("");
  $("vehicles").innerHTML=`<h3>Current Vehicles</h3>${bullets(p.visible||[])}${details}${locked(p.lockedCount,"Additional vehicle intelligence")}${unlockNote(p.lockedCount)}<h3>Optimization / Missing Vehicle Actions</h3>${bullets(v.recommendations||[])}`;
}
function renderAgencies(a) {
  $("agencies").innerHTML=(a.agencies||[]).length?a.agencies.map(x=>`<div class="agency-row"><div><strong>${esc(x.agency)}</strong><span>${esc(x.basis||"")}</span></div><b>${esc(x.fitScore)}%</b></div>`).join(""):unavailable("No confirmed agency alignment is available from current award/buyer evidence.");
}
function renderCompetitors(c) {
  const p=preview("competitors",c.records||[]);
  $("competitors").innerHTML=(p.visible||[]).length?`<table><thead><tr><th>Company</th><th>Federal Revenue</th><th>Awards</th><th>Vehicle</th><th>Agencies</th></tr></thead><tbody>${p.visible.map(x=>`<tr><td>${esc(x.company)}</td><td>${money(x.federalRevenue)}</td><td>${esc(x.awardCount??"—")}</td><td>${esc(x.vehicle||"Unavailable")}</td><td>${esc((x.agencies||[]).join(", ")||"Unavailable")}</td></tr>`).join("")}</tbody></table>${locked(p.lockedCount,"Additional competitor intelligence")}${unlockNote(p.lockedCount)}`:unavailable("No defensible competitor candidates were identified from the current ORION peer model.");
  $("competitorDisclosure").textContent=c.disclosure||"";
}
function renderPrimes(p0) {
  const p=preview("primePartners",p0.records||[]);
  $("primes").innerHTML=rows(p.visible||[],x=>`<div class="partner"><strong>${esc(x.company)}</strong><span>${esc(x.partnerStatus||x.confidence||"MODELED CANDIDATE")}</span><span>Vehicle: ${esc(x.vehicle||"Not yet confirmed")}</span><span>Federal revenue: ${money(x.federalRevenue)}</span><span>Agencies: ${esc((x.agencies||[]).join(", ")||"Not yet confirmed")}</span></div>`)+locked(p.lockedCount,"Additional teaming partner")+unlockNote(p.lockedCount)+`<h3>Teaming Strategy</h3>${bullets(p0.strategy||[])}`;
}
function renderSubs(s) {
  $("subcontracting").innerHTML=`${statusPill(s.status)}${rows(s.records||[],x=>`<div class="opportunity"><strong>${esc(x.title)}</strong><span>${esc(x.source||"")}</span></div>`)}<h3>Recommended Partner Actions</h3>${bullets(s.strategy||[])}`;
}
function renderBuyers(b) {
  const p=preview("buyers",b.records||[]);
  $("buyers").innerHTML=(p.visible||[]).length?`<table><thead><tr><th>Agency</th><th>Buyer / Office</th><th>Historical Award Value</th><th>Awards</th></tr></thead><tbody>${p.visible.map(x=>`<tr><td>${esc(x.agency||"Unavailable")}</td><td>${esc(x.buyer||"Unavailable")}</td><td>${money(x.historicalAwardValue??x.spend)}</td><td>${esc(x.awardCount??"—")}</td></tr>`).join("")}</tbody></table>${locked(p.lockedCount,"Additional buyer intelligence")}${unlockNote(p.lockedCount)}`:unavailable(b?.status&&/CONFIRMED_NO/.test(b.status)?"Authoritative award history produced no buyer records.":"No confirmed buyer history is currently available.");
}
function opportunityCard(x) {
  const href=safeUrl(x.sourceUrl);
  const source=href?`<a href="${esc(href)}" target="_blank" rel="noopener">${esc(x.source||"Source")}</a>`:esc(x.source||"Source unavailable");
  const meta=[x.agency,x.stage,x.naics?`NAICS ${x.naics}`:null,x.setAside,x.dueDate?`Due ${x.dueDate}`:null,x.fitScore!=null?`Fit ${x.fitScore}/100`:null].filter(Boolean).join(" • ");
  return `<div class="opportunity"><strong>${esc(x.title||"Untitled")}</strong><span>${esc(meta)}</span><span>${source}</span><small>${esc(x.qualification||"")}</small></div>`;
}
function renderOpportunities(o) {
  const live=preview("opportunities",o.liveAndForecast||[]), recomp=preview("recompetes",o.recompetes||[]);
  if((live.visible||[]).length) {
    $("opportunities").innerHTML=(live.visible||[]).map(opportunityCard).join("")+locked(live.lockedCount,"Additional matched opportunity")+unlockNote(live.lockedCount);
  } else {
    const coverage=o.sourceCoverage||{};
    $("opportunities").innerHTML=unavailable(coverage.fresh===false?`Current public opportunity coverage is not fresh/available (${coverage.status||"source unavailable"}); the demo will not pretend there are zero matches.`:"No current qualified public opportunity candidate matched the available evidence.");
  }
  $("recompetes").innerHTML=(recomp.visible||[]).length?(recomp.visible||[]).map(x=>`<div class="opportunity"><strong>${esc(x.title||"Untitled")}</strong><span>${esc(x.agency||"Agency unavailable")}${x.date?` • ${esc(x.date)}`:""}${x.value?` • ${money(x.value)}`:""}</span><small>${esc(x.qualification||"")}</small></div>`).join("")+locked(recomp.lockedCount,"Additional recompete signal")+unlockNote(recomp.lockedCount):unavailable("No validated current recompete signal is available. Generic zero-award monitoring placeholders are suppressed.");
}
function renderPathway(p){$("pathwayTitle").textContent=p.title||"Evidence Completion Pathway™";$("pathway").innerHTML=(p.steps||[]).map((x,i)=>`<div class="path-step"><b>Step ${i+1}</b><span>${esc(x)}</span></div>`).join('<div class="arrow">↓</div>');}
function renderRecommendations(r){const groups=[["Immediate Actions",r.immediate],["Vehicle Strategy",r.vehicle],["Agency Strategy",r.agency],["Prime / Partner Strategy",r.partner],["Opportunity Strategy",r.opportunity],["Growth Strategy",r.growth]];$("recommendations").innerHTML=groups.map(([title,items])=>`<div class="rec-group"><h3>${esc(title)}</h3>${bullets(items||[])}</div>`).join("");}
function render(m){
  current=m;
  renderProfile(m.profile||{});renderReadiness(m.readiness||{});renderState(m);renderRevenue(m.revenue||{});renderAwards(m.awardHistory||{});renderVehicles(m.vehicles||{});renderAgencies(m.agencyAlignment||{});renderCompetitors(m.competitors||{});renderPrimes(m.primePartners||{});renderSubs(m.subcontracting||{});renderBuyers(m.buyerIntelligence||{});renderOpportunities(m.opportunities||{});renderPathway(m.pathway||{});renderRecommendations(m.recommendations||{});
  $("generatedAt").textContent=`Generated ${new Date(m.generatedAt).toLocaleString()} • ${m.status||""}`;
  $("welcome").classList.add("hidden");$("report").classList.remove("hidden");$("refresh").disabled=false;$("print").disabled=false;$("download").disabled=false;
}
async function analyze(refresh=false){const term=$("term").value.trim();if(!term){$("term").focus();return;}$("loading").classList.remove("hidden");$("error").classList.add("hidden");$("analyze").disabled=true;$("refresh").disabled=true;try{const res=await fetch(`/api/assessment?term=${encodeURIComponent(term)}${refresh?"&refresh=1":""}`,{cache:"no-store"});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.message||data.error||data.status||"Assessment failed");render(data);}catch(error){$("error").textContent=error.message;$("error").classList.remove("hidden");}finally{$("loading").classList.add("hidden");$("analyze").disabled=false;$("refresh").disabled=current?false:true;}}
$("analyze").addEventListener("click",()=>analyze(false));$("refresh").addEventListener("click",()=>analyze(true));$("print").addEventListener("click",()=>window.print());$("download").addEventListener("click",()=>{if(current){window.location.href=`/api/blueprint?term=${encodeURIComponent(current.profile?.uei||current.profile?.companyName)}&format=md`;}});$("term").addEventListener("keydown",e=>{if(e.key==="Enter")analyze(false);});
