"use strict";

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(Number(value || 0));
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));

function card(title, value, sub) {
  return `<div class="score"><span>${esc(title)}</span><b>${esc(value)}</b><small>${esc(sub || "")}</small></div>`;
}
function rows(items, render, empty="None") {
  return items && items.length ? items.map(render).join("") : `<div class="empty">${esc(empty)}</div>`;
}

async function getJson(url, options={}) {
  const response = await fetch(url, { cache:"no-store", ...options });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error((data && (data.error || data.message)) || text || `HTTP ${response.status}`);
  return data;
}

async function loadState() {
  const state = await getJson("/api/state");
  const revenue = state.revenue || {};
  const summary = state.executiveSummary || {};
  const queue = state.workQueue || {};
  $("scoreGrid").innerHTML = [
    card("Company Health", summary.companyHealthScore ?? "—", summary.companyHealthStatus || "UNKNOWN"),
    card("Weekly Revenue", money(revenue.current), `${revenue.progressPct ?? 0}% of ${money(revenue.goal || 10000)}`),
    card("Pipeline", money(revenue.pipeline), `${revenue.pipelineDeals || 0} deals`),
    card("Open Work", queue.open ?? 0, `${queue.blocked || 0} blocked`),
    card("Kevin Approval", queue.awaitingApproval ?? 0, "Items requiring CEO decision"),
    card("Runtime", summary.runtimeStatus || state.cooRuntime?.runtimeHealthStatus || "UNKNOWN", state.cooRuntime?.latestCycleStatus || "")
  ].join("");

  $("approvals").innerHTML = rows(queue.approvalItems || [], x => `<div class="row"><b>${esc(x.title || x.id)}</b><div class="muted">${esc(x.area || "")} · ${esc(x.status || "")}</div></div>`, "No CEO approvals waiting.");
  $("alerts").innerHTML = rows(state.alerts || [], x => `<div class="row"><b>${esc(x.severity || "INFO")} · ${esc(x.title || x.area || "Alert")}</b><div class="muted">${esc(x.message || x.action || "")}</div></div>`, "No current alerts.");

  const marketing = state.marketing || {};
  $("marketing").innerHTML = `<div class="mini-grid">${card("Status", marketing.status || "UNKNOWN", "")}${card("Active Campaigns", marketing.activeCampaigns || 0, `${marketing.totalCampaigns || 0} total`)}${card("Emails Today", marketing.emailsSentToday || 0, "")}</div>`;

  const orion = state.orion || {};
  $("orion").innerHTML = `<div class="mini-grid">${card("Status", orion.status || "UNKNOWN", "")}${card("Contractors", orion.contractors || 0, "")}${card("Buyers", orion.buyers || 0, "")}</div>`;

  $("work").innerHTML = rows(queue.recentItems || [], x => `<div class="row"><b>${esc(x.title || x.id)}</b><div class="muted">${esc(x.status || "")} · ${esc(x.area || "")} · P${esc(x.priority || "")}</div></div>`, "No recent work.");
  $("activity").innerHTML = rows((state.activityFeed || []).slice(0,20), x => `<div class="row"><b>${esc(x.title || x.type)}</b><div class="muted">${esc(x.timestamp || "")} · ${esc(x.detail || "")}</div></div>`, "No recent activity.");
}

async function loadBrief() {
  $("briefStatus").textContent = "Refreshing daily revenue position...";
  try {
    const brief = await getJson("/api/brief");
    const s = brief.scorecard || {};
    $("briefStatus").textContent = `${s.status || "UNKNOWN"} · Generated ${new Date(brief.generatedAt).toLocaleString()}`;
    $("briefBody").innerHTML = `
      <div class="brief-metrics">
        ${card("Revenue", money(s.currentRevenue), `${s.progressPct || 0}% complete`)}
        ${card("Gap", money(s.remainingGap), "to $10K/week")}
        ${card("Pipeline", money(s.pipeline), `${s.pipelineCoverage == null ? "goal met" : s.pipelineCoverage + "x gap coverage"}`)}
      </div>
      <div class="assessment">${esc(brief.milesAssessment || "")}</div>
      <h3>What MILES says needs to happen next</h3>
      <ol>${(brief.topActions || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>No supported action available.</li>"}</ol>
      <div class="ceo-attn">${brief.requiresKevin ? `<b>CEO attention:</b> ${brief.approvalCount} approval item(s) are waiting.` : "No current CEO approval blocker."}</div>`;
  } catch (error) {
    $("briefStatus").textContent = `Brief unavailable: ${error.message}`;
  }
}

async function sendCommand() {
  const command = $("commandText").value.trim();
  if (!command) return;
  $("sendCommand").disabled = true;
  $("commandResult").textContent = "Sending command to MILES...";
  try {
    const data = await getJson("/api/command", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ command })
    });
    $("commandResult").textContent = JSON.stringify(data, null, 2);
    await Promise.all([loadState(), loadBrief()]);
  } catch (error) {
    $("commandResult").textContent = `Command failed: ${error.message}`;
  } finally {
    $("sendCommand").disabled = false;
  }
}

$("refreshBrief").addEventListener("click", () => Promise.all([loadState(), loadBrief()]));
$("sendCommand").addEventListener("click", sendCommand);
Promise.all([loadState(), loadBrief()]).catch(error => console.error(error));
setInterval(() => loadState().catch(()=>{}), 60000);
