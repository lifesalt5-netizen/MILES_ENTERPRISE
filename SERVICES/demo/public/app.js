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
function proofLine(name) {
  const t=current?.commercialPreview?.totals?.[name];
  const p=current?.commercialPreview?.[name];
  if(!t||!p) return "";
  const pieces=[`${Number(t.total||0).toLocaleString()} identified`,`${Number(p.visibleCount||0).toLocaleString()} shown`,`${Number(p.lockedCount||0).toLocaleString()} locked`];
  if(Number(t.knownValueCount||0)>0) pieces.splice(1,0,`${money(t.knownValue)} known value across ${Number(t.knownValueCount).toLocaleString()} valued record${Number(t.knownValueCount)===1?"":"s"}`);
  if(Number(t.unknownValueCount||0)>0) pieces.splice(2,0,`${Number(t.unknownValueCount).toLocaleString()} value${Number(t.unknownValueCount)===1?"":"s"} not disclosed`);
  if(Number(t.agencies||0)>0) pieces.splice(1,0,`${Number(t.agencies).toLocaleString()} agencies`);
  return `<div class="unlock-note"><strong>${esc(pieces.join(" • "))}</strong><span>Totals describe known underlying records; locked identities/details are available in the applicable P2GC engagement.</span></div>`;
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
  $("overallScore").textContent = r.overall==null ? "Unavailable" : `${r.overall}/100`;
  $("scoreMethod").textContent = r.methodology || "";
  $("readinessGrid").innerHTML = Object.values(r.categories||{}).map(c=>`<article class="score-card"><div class="score-card-head"><strong>${esc(c.label)}</strong><b>${c.score==null?"Unavailable":`${esc(c.score)}%`}</b></div><div class="bar"><span style="width:${c.score==null?0:Math.max(0,Math.min(100,c.score))}%"></span></div><details><summary>Why this score</summary><div class="evidence good"><b>Evidence:</b>${(c.evidence||[]).length?`<ul>${c.evidence.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:" None identified"}</div><div class="evidence miss"><b>Missing:</b>${(c.missing||[]).length?`<ul>${c.missing.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:" None"}</div></details></article>`).join("");
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
  $("vehicles").innerHTML=`${proofLine("vehicles")}<h3>Current Vehicles</h3>${bullets(p.visible||[])}${details}${locked(p.lockedCount,"Additional vehicle intelligence")}${unlockNote(p.lockedCount)}<h3>Optimization / Missing Vehicle Actions</h3>${bullets(v.recommendations||[])}`;
}
function renderAgencies(a) {
  $("agencies").innerHTML=(a.agencies||[]).length?a.agencies.map(x=>`<div class="agency-row"><div><strong>${esc(x.agency)}</strong><span>${esc(x.basis||"")}</span></div><b>${esc(x.fitScore)}%</b></div>`).join(""):unavailable("No confirmed agency alignment is available from current award/buyer evidence.");
}
function renderCompetitors(c) {
  const p=preview("competitors",c.records||[]);
  $("competitors").innerHTML=proofLine("competitors")+((p.visible||[]).length?`<table><thead><tr><th>Company</th><th>Federal Revenue</th><th>Awards</th><th>Vehicle</th><th>Agencies</th></tr></thead><tbody>${p.visible.map(x=>`<tr><td>${esc(x.company)}</td><td>${money(x.federalRevenue)}</td><td>${esc(x.awardCount??"—")}</td><td>${esc(x.vehicle||"Unavailable")}</td><td>${esc((x.agencies||[]).join(", ")||"Unavailable")}</td></tr>`).join("")}</tbody></table>${locked(p.lockedCount,"Additional competitor intelligence")}${unlockNote(p.lockedCount)}`:unavailable("No defensible competitor candidates were identified from the current ORION peer model."));
  $("competitorDisclosure").textContent=c.disclosure||"";
}
function renderPrimes(p0) {
  const p=preview("primePartners",p0.records||[]);
  $("primes").innerHTML=proofLine("primePartners")+rows(p.visible||[],x=>`<div class="partner"><strong>${esc(x.company)}</strong><span>${esc(x.partnerStatus||x.confidence||"MODELED CANDIDATE")}</span><span>Fit: ${x.fitScore==null?"Validation required":`${esc(x.fitScore)}/100`}</span><span>Vehicle: ${esc(x.vehicle||"Not yet confirmed")}</span><span>Federal obligations: ${money(x.federalRevenue)}</span><span>Shared agencies: ${esc((x.agencies||[]).join(", ")||"Not yet confirmed")}</span><small>${esc(x.basis||"")}</small></div>`)+locked(p.lockedCount,"Additional teaming partner")+unlockNote(p.lockedCount)+`<h3>Teaming Strategy</h3>${bullets(p0.strategy||[])}`;
}
function renderSubs(s) {
  $("subcontracting").innerHTML=`${statusPill(s.status)}${rows(s.records||[],x=>`<div class="opportunity"><strong>${esc(x.title)}</strong><span>${esc(x.source||"")}</span></div>`)}<h3>Recommended Partner Actions</h3>${bullets(s.strategy||[])}`;
}
function renderBuyers(b) {
  const p=preview("buyers",b.records||[]);
  $("buyers").innerHTML=proofLine("buyers")+((p.visible||[]).length?`<table><thead><tr><th>Agency</th><th>Buyer / Office</th><th>Historical Award Value</th><th>Awards</th></tr></thead><tbody>${p.visible.map(x=>`<tr><td>${esc(x.agency||"Unavailable")}</td><td>${esc(x.buyer||"Unavailable")}</td><td>${money(x.historicalAwardValue??x.spend)}</td><td>${esc(x.awardCount??"—")}</td></tr>`).join("")}</tbody></table>${locked(p.lockedCount,"Additional buyer intelligence")}${unlockNote(p.lockedCount)}`:unavailable(b?.status&&/CONFIRMED_NO/.test(b.status)?"Authoritative award history produced no buyer records.":"No confirmed buyer history is currently available."));
}
function opportunityCard(x) {
  const href=safeUrl(x.sourceUrl);
  const source=href?`<a href="${esc(href)}" target="_blank" rel="noopener">${esc(x.source||"Source")}</a>`:esc(x.source||"Source unavailable");
  const meta=[x.agency,x.stage,x.naics?`NAICS ${x.naics}`:null,x.setAside,x.dueDate?`Due ${x.dueDate}`:null,x.fitScore!=null?`Fit ${x.fitScore}/100`:null].filter(Boolean).join(" • ");
  const blocker=x.eligibilityBlocker?`<small><strong>Eligibility:</strong> ${esc(x.eligibilityBlocker)}</small>`:"";
  return `<div class="opportunity"><strong>${esc(x.title||"Untitled")}</strong><span>${esc(meta)}</span><span>${source}</span><small>${esc(x.qualification||"")}</small>${blocker}</div>`;
}
function renderOpportunities(o) {
  const live=preview("opportunities",o.liveAndForecast||[]), recomp=preview("recompetes",o.recompetes||[]);
  if((live.visible||[]).length) {
    $("opportunities").innerHTML=proofLine("opportunities")+(live.visible||[]).map(opportunityCard).join("")+locked(live.lockedCount,"Additional matched opportunity")+unlockNote(live.lockedCount);
  } else {
    const coverage=o.sourceCoverage||{};
    $("opportunities").innerHTML=proofLine("opportunities")+unavailable(coverage.fresh===false?`Current public opportunity coverage is not fresh/available (${coverage.status||"source unavailable"}); the demo will not pretend there are zero matches.`:"No current qualified public opportunity candidate matched the available evidence.");
  }
  $("recompetes").innerHTML=proofLine("recompetes")+((recomp.visible||[]).length?(recomp.visible||[]).map(x=>`<div class="opportunity"><strong>${esc(x.title||"Untitled")}</strong><span>${esc(x.agency||"Agency unavailable")}${x.date?` • ${esc(x.date)}`:""}${x.value?` • ${money(x.value)}`:""}</span><small>${esc(x.qualification||"")}</small></div>`).join("")+locked(recomp.lockedCount,"Additional recompete signal")+unlockNote(recomp.lockedCount):unavailable("No validated current recompete signal is available. Generic zero-award monitoring placeholders are suppressed."));
}
function renderPathway(p){$("pathwayTitle").textContent=p.title||"Evidence Completion Pathway™";$("pathway").innerHTML=(p.steps||[]).map((x,i)=>`<div class="path-step"><b>Step ${i+1}</b><span>${esc(x)}</span></div>`).join('<div class="arrow">↓</div>');}
function renderRecommendations(r){const groups=[["Immediate Actions",r.immediate],["Vehicle Strategy",r.vehicle],["Agency Strategy",r.agency],["Prime / Partner Strategy",r.partner],["Opportunity Strategy",r.opportunity],["Growth Strategy",r.growth]];$("recommendations").innerHTML=groups.map(([title,items])=>`<div class="rec-group"><h3>${esc(title)}</h3>${bullets(items||[])}</div>`).join("");}

function renderSalesStory(m){
  const p=m.profile||{}, s=m.currentState||{}, totals=m.commercialPreview?.totals||{};
  const awards=Number(m.awardHistory?.summary?.awardCount||0);
  const currentOblig=m.revenue?.current?.federal;
  const buyerTotal=Number(totals.buyers?.total||0), agencyTotal=Number(totals.buyers?.agencies||0);
  const oppTotal=Number(totals.opportunities?.total||0), primeTotal=Number(totals.primePartners?.total||0);
  const recompeteTotal=Number(totals.recompetes?.total||0), recompeteValue=Number(totals.recompetes?.knownValue||0);
  const currentGsa=p.gsaHolderVerified===true || /CURRENT GSA MAS HOLDER/i.test(String(p.gsaStatus||""));
  const samUnknown=s.samRegistration==null;
  const blockedOpps=(m.opportunities?.liveAndForecast||[]).filter(x=>x.directPursuitEligible===false).length;
  const readiness=m.readiness?.overall;
  const fullyReconciled=m.truthIntegrity?.fullyReconciled===true;
  const coverageBlockers=(m.truthIntegrity?.blockers||[]).length;
  const verifiedFederalPosition=awards>0 || currentGsa || (currentOblig!=null && Number(currentOblig)>0) || buyerTotal>0;

  const position=[];
  if(awards>0) position.push(`Established federal contractor with ${awards.toLocaleString()} confirmed federal award records in authoritative history.`);
  if(currentGsa) position.push('Current GSA MAS access is confirmed.');
  if(currentOblig!=null && Number(currentOblig)>0) position.push(`The governed current measurement window shows ${money(currentOblig)} in federal obligations.`);
  if(oppTotal||recompeteTotal||primeTotal) position.push(`Current intelligence contains ${oppTotal} matched public opportunity candidates, ${recompeteTotal} recompete signals, and ${primeTotal} evidence-backed modeled prime/team candidates.`);
  if(samUnknown) position.push('Current SAM status remains unverified in the governed source set and is not inferred from other sources.');
  if(!fullyReconciled && coverageBlockers>0) position.push('Some authoritative source coverage is still incomplete; those facts remain explicitly unavailable rather than inferred.');
  $("executivePosition").innerHTML=position.length?`<p>${position.map(esc).join(' ')}</p>`:unavailable('The current evidence set is not sufficient for an executive position statement.');

  const strengths=[];
  if(currentGsa) strengths.push('Current GSA MAS access confirmed from current GSA evidence.');
  if(awards>0) strengths.push(`${awards.toLocaleString()} federal award records confirmed in authoritative award history.`);
  if(currentOblig!=null && Number(currentOblig)>0) strengths.push(`${money(currentOblig)} in current measurement-window federal obligations.`);
  if(buyerTotal>0) strengths.push(`${buyerTotal} buyer records across ${agencyTotal} confirmed agenc${agencyTotal===1?'y':'ies'}.`);
  if(oppTotal>0) strengths.push(`${oppTotal} current public opportunity candidates identified for qualification.`);
  if(recompeteTotal>0) strengths.push(`${recompeteTotal} recompete signals${recompeteValue>0?` with ${money(recompeteValue)} in known contract value`:''}.`);
  if(primeTotal>0) strengths.push(`${primeTotal} evidence-backed modeled prime/team candidates available for validation.`);
  $("strengths").innerHTML=bullets(strengths);

  const primary=currentGsa
    ? 'The evidence does not support a generic vehicle-access problem. Current GSA MAS access is confirmed; the growth question is which opportunities, recompetes, buyers and prime relationships deserve qualification and pursuit.'
    : ((p.contractVehicles||[]).length ? 'Current vehicle access exists; the priority is validating utilization, buyer alignment and opportunity fit.' : 'Current vehicle/access position requires validation before P2GC recommends an access strategy.');
  const secondary=samUnknown
    ? 'SAM registration, CAGE and certification coverage are not fully verified in the current governed source set, so the demo keeps those facts unknown rather than inferring them.'
    : ((m.gaps?.items||[])[0]||'No secondary issue is asserted without current evidence.');
  const growth=`The visible market contains ${oppTotal} current opportunity candidates, ${recompeteTotal} recompete signals and ${primeTotal} modeled prime/team candidates. These are qualification inputs, not automatic bid or relationship claims.`;
  const risk=blockedOpps>0
    ? `${blockedOpps} current opportunity candidate${blockedOpps===1?'':'s'} require set-aside eligibility verification before direct pursuit.`
    : (!fullyReconciled?'Incomplete authoritative coverage must be resolved before relying on unavailable facts.':'Modeled opportunity and partner signals still require validation before external pursuit or outreach.');
  const readinessText=readiness==null?'Readiness is withheld where the evidence is incomplete.':`Current evidence-backed readiness score is ${readiness}/100; only categories with explicit current checks are scored.`;
  $("diagnosis").innerHTML=[['Primary Issue',primary],['Secondary Issue',secondary],['Growth Opportunity',growth],['Immediate Risk',risk],['Readiness',readinessText]].map(([label,value])=>`<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');

  const nothing=[];
  if(oppTotal) nothing.push(`${oppTotal} current opportunity candidates remain unqualified beyond the representative preview.`);
  if(primeTotal) nothing.push(`${primeTotal} modeled prime/team candidates remain unvalidated for contract, capability-whitespace and contact fit.`);
  if(recompeteTotal) nothing.push(`${recompeteTotal} recompete signals remain to be prioritized against value, timing and fit.`);
  if(samUnknown) nothing.push('SAM/CAGE/certification coverage remains unresolved in the current governed source set.');
  if(!fullyReconciled) nothing.push('Authoritative coverage gaps remain unresolved, so unavailable facts cannot yet support pursuit decisions.');
  nothing.push('Without a validated execution roadmap, the available signals remain unprioritized for action.');
  $("trajectoryNow").innerHTML=bullets(nothing);

  const withP2gc=[];
  if(!fullyReconciled) withP2gc.push('Resolve the authoritative identity, registration, award, vehicle and opportunity coverage gaps before making unsupported pursuit assumptions.');
  if(oppTotal) withP2gc.push(`Qualify the full ${oppTotal} current-opportunity inventory against scope, set-aside, vehicle and buyer fit.`);
  if(primeTotal) withP2gc.push(`Validate and rank ${primeTotal} modeled prime/team candidates and identify lawful SBLO/teaming contacts where available.`);
  if(recompeteTotal) withP2gc.push(`Prioritize ${recompeteTotal} recompete signals${recompeteValue>0?` representing ${money(recompeteValue)} in known value`:''}.`);
  if(buyerTotal) withP2gc.push(`Prioritize ${buyerTotal} buyer records across ${agencyTotal} agencies using confirmed history and current demand.`);
  withP2gc.push(currentGsa?'Map current GSA MAS scope to the highest-value qualified demand and buyer paths.':'Validate the acquisition-vehicle/access path before recommending vehicle investment.');
  withP2gc.push('Build the paid capture, partner and execution roadmap with owners, deadlines and measurable milestones.');
  $("trajectoryP2gc").innerHTML=bullets(withP2gc);

  const paid=[];
  if(!fullyReconciled) paid.push('Resolve each explicit authoritative coverage gap and document the source/provenance for the resulting fact.');
  if(oppTotal) paid.push(`Qualify all ${oppTotal} current opportunity candidates; values remain undisclosed where the public source does not publish a positive amount.`);
  if(primeTotal) paid.push(`Validate and rank all ${primeTotal} evidence-backed modeled prime/team candidates.`);
  if(recompeteTotal) paid.push(`Prioritize ${recompeteTotal} recompete signals${recompeteValue>0?` with ${money(recompeteValue)} in known contract value`:''}.`);
  if(buyerTotal) paid.push(`Prioritize buyers and agency expansion using the ${buyerTotal} confirmed buyer records across ${agencyTotal} agencies.`);
  paid.push(currentGsa?'Build the GSA utilization and buyer-access strategy from the confirmed current MAS position.':'Complete vehicle/access validation before recommending an investment or pursuit path.');
  paid.push('Deliver the complete capture, teaming and execution roadmap rather than exposing the full playbook in the preview.');
  const paidIntro=verifiedFederalPosition
    ? 'The current evidence confirms a meaningful federal position and provides concrete inputs for prioritization. The next step is to validate the complete position, rank the highest-value paths, and build the execution roadmap.'
    : 'The current public evidence is not sufficient to confirm a complete federal position. Federal Pathway Validation™ is the next step to resolve the missing authoritative facts first, then determine the correct market-entry, vehicle, teaming and pursuit path.';
  $("paidNextStep").innerHTML=`<p>${esc(paidIntro)}</p>${bullets(paid)}`;
}

function render(m){
  current=m;
  renderProfile(m.profile||{});renderSalesStory(m);renderReadiness(m.readiness||{});renderState(m);renderRevenue(m.revenue||{});renderAwards(m.awardHistory||{});renderVehicles(m.vehicles||{});renderAgencies(m.agencyAlignment||{});renderCompetitors(m.competitors||{});renderPrimes(m.primePartners||{});renderSubs(m.subcontracting||{});renderBuyers(m.buyerIntelligence||{});renderOpportunities(m.opportunities||{});renderPathway(m.pathway||{});renderRecommendations(m.recommendations||{});
  $("generatedAt").textContent=`Generated ${new Date(m.generatedAt).toLocaleString()} • ${m.status||""}`;
  $("welcome").classList.add("hidden");$("report").classList.remove("hidden");$("refresh").disabled=false;$("print").disabled=false;$("download").disabled=false;
}
async function analyze(refresh=false){const term=$("term").value.trim();if(!term){$("term").focus();return;}$("loading").classList.remove("hidden");$("error").classList.add("hidden");$("analyze").disabled=true;$("refresh").disabled=true;try{const res=await fetch(`/api/assessment?term=${encodeURIComponent(term)}${refresh?"&refresh=1":""}`,{cache:"no-store"});const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.message||data.error||data.status||"Assessment failed");render(data);}catch(error){$("error").textContent=error.message;$("error").classList.remove("hidden");}finally{$("loading").classList.add("hidden");$("analyze").disabled=false;$("refresh").disabled=current?false:true;}}
$("analyze").addEventListener("click",()=>analyze(false));$("refresh").addEventListener("click",()=>analyze(true));$("print").addEventListener("click",()=>window.print());$("download").addEventListener("click",()=>{if(current){window.location.href=`/api/blueprint?term=${encodeURIComponent(current.profile?.uei||current.profile?.companyName)}&format=md`;}});$("term").addEventListener("keydown",e=>{if(e.key==="Enter")analyze(false);});