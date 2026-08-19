"use strict";

let currentTerm = "";

const el = id => document.getElementById(id);
const money = value => {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(n) : "Unavailable";
};
const text = value => value == null || value === "" ? "Unavailable" : String(value);

function itemList(target, items, render) {
  const node = el(target);
  if (!items || !items.length) {
    node.innerHTML = '<div class="unavailable">Unavailable in current evidence.</div>';
    return;
  }
  node.innerHTML = items.map(render).join("");
}

function render(data) {
  const identity = data.identity || {};
  el("companyName").textContent = identity.name || data.request?.term || "Prospect";
  el("generatedAt").textContent = `Generated ${new Date(data.generatedAt).toLocaleString()} · read-only · unsupported facts are not fabricated`;

  el("availability").innerHTML = Object.entries(data.availability || {}).map(([key, available]) =>
    `<span class="chip ${available ? "ok" : "na"}">${key}: ${available ? "available" : "unavailable"}</span>`
  ).join("");

  const identityCards = [
    ["UEI", identity.uei],
    ["Primary NAICS", identity.primaryNaics],
    ["Location", [identity.city, identity.state].filter(Boolean).join(", ")],
    ["Entity status", identity.entityStatus],
    ["Current vehicle", data.vehicle?.current]
  ];
  el("identityGrid").innerHTML = identityCards.map(([label,value]) =>
    `<div class="metric"><span>${label}</span><b>${text(value)}</b></div>`
  ).join("");

  const awards = data.awardHistory || {};
  if (awards.available) {
    el("awards").innerHTML = `<div class="award-summary"><div><b>${money(awards.summary?.federalRevenue)}</b><span>Federal revenue</span></div><div><b>${text(awards.summary?.awardCount)}</b><span>Distinct awards</span></div><div><b>${text(awards.status)}</b><span>Authority status</span></div></div>`;
  } else {
    el("awards").innerHTML = `<div class="unavailable">${text(awards.status)}${awards.reason ? ` — ${awards.reason}` : ""}</div>`;
  }

  itemList("agencies", data.agencyAlignment?.agencies || [], x => `<div class="row">${text(x)}</div>`);
  itemList("opportunities", data.opportunities?.records || [], x => `<div class="row"><b>${text(x.title)}</b><div class="muted">${text(x.source)}${x.dueDate ? ` · due ${x.dueDate}` : ""}${x.status ? ` · ${x.status}` : ""}</div></div>`);
  itemList("recompetes", data.recompetes?.records || [], x => `<div class="row"><b>${text(x.title)}</b><div class="muted">${text(x.signalType)}${x.expectedDate ? ` · ${x.expectedDate}` : ""}${x.qualification ? ` · ${x.qualification}` : ""}</div></div>`);

  const vehicle = data.vehicle || {};
  el("vehicle").innerHTML = `<div class="row"><b>Current:</b> ${text(vehicle.current)}</div>` +
    ((vehicle.recommendations || []).length ? vehicle.recommendations.map(x => `<div class="row">${text(x)}</div>`).join("") : '<div class="unavailable">No supported vehicle recommendations available.</div>');

  itemList("contacts", data.contacts?.records || [], x => `<div class="row"><b>${text(x.name || "Contact")}</b><div class="muted">${[x.title,x.email,x.phone].filter(Boolean).join(" · ") || "No additional contact fields available"}</div><div class="source">${text(x.source)}</div></div>`);
  itemList("actions", data.recommendations?.priorityActions || [], x => `<div class="row">${text(x)}</div>`);
  el("evidence").textContent = JSON.stringify(data.evidence || {}, null, 2);

  const q = encodeURIComponent(currentTerm);
  el("exportJson").href = `/api/demo/export?company=${q}&format=json`;
  el("exportMarkdown").href = `/api/demo/export?company=${q}&format=md`;
  el("exportHtml").href = `/api/demo/export?company=${q}&format=html`;
  el("refreshDemo").disabled = false;
  el("demoResult").classList.remove("hidden");
}

async function loadDemo(forceRefresh = false) {
  const term = (forceRefresh ? currentTerm : el("companyTerm").value).trim();
  if (!term) { el("companyTerm").focus(); return; }
  currentTerm = term;
  el("runDemo").disabled = true;
  el("refreshDemo").disabled = true;
  el("demoStatus").textContent = forceRefresh ? "Refreshing current evidence..." : "Resolving company and building evidence-backed assessment...";

  try {
    const response = await fetch(`/api/demo?company=${encodeURIComponent(term)}&refresh=${forceRefresh ? "1" : "0"}`, { cache:"no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || data.message || data.status || `Demo request failed (${response.status})`);
    render(data);
    el("demoStatus").textContent = `Demo ready: ${data.identity?.name || term}`;
  } catch (error) {
    el("demoStatus").textContent = `Demo unavailable: ${error.message}`;
    el("demoResult").classList.add("hidden");
  } finally {
    el("runDemo").disabled = false;
    el("refreshDemo").disabled = !currentTerm;
  }
}

el("runDemo").addEventListener("click", () => loadDemo(false));
el("refreshDemo").addEventListener("click", () => loadDemo(true));
el("companyTerm").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); loadDemo(false); }
});

const preset = new URLSearchParams(location.search).get("company");
if (preset) {
  el("companyTerm").value = preset;
  loadDemo(false);
}
