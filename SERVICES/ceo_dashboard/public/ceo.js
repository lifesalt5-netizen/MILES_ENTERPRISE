"use strict";

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(Number(value || 0));
const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
const APPROVAL_STATUSES = new Set(["AWAITING_APPROVAL", "WAITING_FOR_CEO_APPROVAL", "AWAITING_CEO_APPROVAL"]);

let canonicalApprovals = [];

function normalizeStatus(value) { return String(value || "UNKNOWN").trim().toUpperCase(); }
function isApproval(operation) { return APPROVAL_STATUSES.has(normalizeStatus(operation && operation.status)); }
function card(title, value, sub, options={}) {
  const id = options.id ? ` id="${esc(options.id)}"` : "";
  const role = options.clickable ? ' role="button" tabindex="0" class="score clickable"' : ' class="score"';
  return `<div${id}${role}><span>${esc(title)}</span><b>${esc(value)}</b><small>${esc(sub || "")}</small></div>`;
}
function rows(items, render, empty="None") { return items && items.length ? items.map(render).join("") : `<div class="empty">${esc(empty)}</div>`; }

async function getJson(url, options={}) {
  const response = await fetch(url, { cache:"no-store", ...options });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error((data && (data.error || data.message)) || text || `HTTP ${response.status}`);
    error.data = data;
    throw error;
  }
  return data;
}

function canonicalPendingFromDashboard(dashboard) {
  return Array.isArray(dashboard && dashboard.operations) ? dashboard.operations.filter(isApproval) : [];
}

function approvalReason(operation) {
  return operation.approvalReason || operation.reason || operation.plan?.governance?.approval?.reason || operation.plan?.governance?.reason || "CEO approval is required by the governed action policy.";
}
function approvalRisk(operation) {
  return operation.risk || operation.plan?.governance?.risk || operation.plan?.governance?.policy?.risk || "UNKNOWN";
}
function approvalImpact(operation) {
  return operation.expectedBusinessImpact || operation.expectedRevenueImpact || operation.plan?.expectedBusinessImpact || operation.plan?.expectedRevenueImpact || operation.plan?.objective || operation.objective || "See requested action and evidence.";
}
function affectedAssets(operation) {
  const candidates = [operation.affectedRecords, operation.affectedFiles, operation.affectedCampaigns, operation.affectedAccounts, operation.targets, operation.plan?.targets].filter(Boolean);
  if (!candidates.length) return "Not explicitly enumerated in the operation record.";
  return candidates.flatMap(value => Array.isArray(value) ? value : [value]).map(value => typeof value === "string" ? value : JSON.stringify(value)).join(", ");
}
function proposedSteps(operation) {
  const steps = operation.plan?.steps || operation.steps || [];
  if (!Array.isArray(steps) || !steps.length) return "No separate execution-step list was recorded.";
  return steps.map((step, index) => `${index + 1}. ${step.objective || step.action || step.capability || JSON.stringify(step)}`).join("\n");
}
function supportingEvidence(operation) {
  return operation.evidence || operation.supportingEvidence || operation.result || operation.plan?.evidence || null;
}

function renderApprovals(items) {
  canonicalApprovals = items || [];
  if ($("approvalCountBadge")) $("approvalCountBadge").textContent = String(canonicalApprovals.length);
  $("approvals").innerHTML = rows(canonicalApprovals, operation => {
    const evidence = supportingEvidence(operation);
    return `<article class="approval-card" data-operation-id="${esc(operation.id)}">
      <div class="approval-card-head"><div><div class="eyebrow">APPROVAL REQUIRED</div><h3>${esc(operation.title || operation.objective || operation.id)}</h3></div><span class="approval-status">${esc(normalizeStatus(operation.status))}</span></div>
      <div class="approval-grid">
        <div><span>Requested by</span><b>${esc(operation.system || operation.provider || "MILES")}</b></div>
        <div><span>Action</span><b>${esc(operation.action || operation.type || "—")}</b></div>
        <div><span>Department</span><b>${esc(operation.department || "—")}</b></div>
        <div><span>Risk</span><b>${esc(approvalRisk(operation))}</b></div>
        <div><span>Created</span><b>${esc(operation.createdAt ? new Date(operation.createdAt).toLocaleString() : "—")}</b></div>
        <div><span>Operation ID</span><b>${esc(operation.id || "—")}</b></div>
      </div>
      <div class="approval-reason"><b>Why approval is required:</b> ${esc(approvalReason(operation))}</div>
      <div class="approval-reason"><b>Expected business/revenue impact:</b> ${esc(approvalImpact(operation))}</div>
      <details class="approval-details"><summary>View Details</summary>
        <div><b>Exact requested action</b><pre>${esc(operation.command || operation.objective || operation.action || "—")}</pre></div>
        <div><b>Affected records/files/campaigns/code/accounts</b><pre>${esc(affectedAssets(operation))}</pre></div>
        <div><b>Proposed execution steps</b><pre>${esc(proposedSteps(operation))}</pre></div>
        <div><b>Supporting evidence/output</b><pre>${esc(evidence ? (typeof evidence === "string" ? evidence : JSON.stringify(evidence, null, 2)) : "No supporting evidence was recorded.")}</pre></div>
      </details>
      <div class="approval-actions">
        <button data-approval-action="approve" data-operation-id="${esc(operation.id)}">Approve</button>
        <button class="secondary" data-approval-action="request-changes" data-operation-id="${esc(operation.id)}">Request Changes</button>
        <button class="danger" data-approval-action="reject" data-operation-id="${esc(operation.id)}">Reject</button>
      </div>
    </article>`;
  }, "No CEO approvals waiting.");
}

function scrollToApprovals() {
  $("approvalPanel")?.scrollIntoView({ behavior:"smooth", block:"start" });
}

function bindKevinMetric() {
  const metric = $("kevinApprovalMetric");
  if (!metric) return;
  metric.addEventListener("click", scrollToApprovals);
  metric.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); scrollToApprovals(); }
  });
}

function isLegacyApprovalAlert(alert) {
  const text = `${alert?.title || ""} ${alert?.message || ""} ${alert?.action || ""}`.toLowerCase();
  return text.includes("kevin approval") || text.includes("approval queue") || text.includes("awaiting kevin approval") || text.includes("work item(s) awaiting kevin") || text.includes("require approval");
}

async function loadState() {
  const [state, dashboard] = await Promise.all([getJson("/api/state"), getJson("/api/dashboard")]);
  const revenue = state.revenue || {};
  const summary = state.executiveSummary || {};
  const queue = state.workQueue || {};
  const pending = canonicalPendingFromDashboard(dashboard);
  const runtimeBacklog = Number(dashboard.taskQueue?.awaitingApproval || 0);

  $("scoreGrid").innerHTML = [
    card("Company Health", summary.companyHealthScore ?? "—", summary.companyHealthStatus || "UNKNOWN"),
    card("Weekly Revenue", money(revenue.current), `${revenue.progressPct ?? 0}% of ${money(revenue.goal || 10000)}`),
    card("Pipeline", money(revenue.pipeline), `${revenue.pipelineDeals || 0} deals`),
    card("Open Work", queue.open ?? 0, `${queue.blocked || 0} blocked`),
    card("Kevin Approval", pending.length, "Canonical CEO decisions", { id:"kevinApprovalMetric", clickable:true }),
    card("Runtime", summary.runtimeStatus || state.cooRuntime?.runtimeHealthStatus || "UNKNOWN", state.cooRuntime?.latestCycleStatus || "")
  ].join("");
  bindKevinMetric();
  renderApprovals(pending);

  const alerts = (state.alerts || []).filter(alert => !isLegacyApprovalAlert(alert));
  if (runtimeBacklog > 0 && runtimeBacklog !== pending.length) {
    alerts.unshift({ severity:"WARNING", title:"Worker runtime approval backlog", message:`${runtimeBacklog} worker-runtime item(s) are classified as awaiting approval. These are tracked separately and are not counted as Kevin approvals.` });
  }
  if (pending.length > 0) alerts.unshift({ severity:"WARNING", title:"Kevin approval queue", message:`${pending.length} canonical CEO approval item(s) require a decision.` });
  $("alerts").innerHTML = rows(alerts, x => `<div class="row"><b>${esc(x.severity || "INFO")} · ${esc(x.title || x.area || "Alert")}</b><div class="muted">${esc(x.message || x.action || "")}</div></div>`, "No current alerts.");

  const marketing = state.marketing || {};
  $("marketing").innerHTML = `<div class="mini-grid">${card("Status", marketing.status || "UNKNOWN", "")}${card("Active Campaigns", marketing.activeCampaigns || 0, `${marketing.totalCampaigns || 0} total`)}${card("Emails Today", marketing.emailsSentToday || 0, "")}</div>`;
  const orion = state.orion || {};
  $("orion").innerHTML = `<div class="mini-grid">${card("Status", orion.status || "UNKNOWN", "")}${card("Contractors", orion.contractors || 0, "")}${card("Buyers", orion.buyers || 0, "")}</div>`;
  $("work").innerHTML = rows(queue.recentItems || [], x => `<div class="row"><b>${esc(x.title || x.id)}</b><div class="muted">${esc(x.status || "")} · ${esc(x.area || "")} · P${esc(x.priority || "")}</div></div>`, "No recent work.");
  $("activity").innerHTML = rows((state.activityFeed || []).slice(0,20), x => `<div class="row"><b>${esc(x.title || x.type)}</b><div class="muted">${esc(x.timestamp || "")} · ${esc(x.detail || "")}</div></div>`, "No recent activity.");
  return { state, dashboard, pending };
}

async function loadBrief() {
  $("briefStatus").textContent = "Refreshing daily revenue position...";
  try {
    const [brief, dashboard] = await Promise.all([getJson("/api/brief"), getJson("/api/dashboard")]);
    const pending = canonicalPendingFromDashboard(dashboard);
    const s = brief.scorecard || {};
    $("briefStatus").textContent = `${s.status || "UNKNOWN"} · Generated ${new Date(brief.generatedAt).toLocaleString()}`;
    $("briefBody").innerHTML = `
      <div class="brief-metrics">${card("Revenue", money(s.currentRevenue), `${s.progressPct || 0}% complete`)}${card("Gap", money(s.remainingGap), "to $10K/week")}${card("Pipeline", money(s.pipeline), `${s.pipelineCoverage == null ? "goal met" : s.pipelineCoverage + "x gap coverage"}`)}</div>
      <div class="assessment">${esc(brief.milesAssessment || "")}</div>
      <h3>What MILES says needs to happen next</h3>
      <ol>${(brief.topActions || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>No supported action available.</li>"}</ol>
      <div class="ceo-attn">${pending.length ? `<b>CEO attention:</b> ${pending.length} canonical approval item(s) are waiting. <button class="inline-button" id="reviewBriefApprovals">Review approvals</button>` : "No current CEO approval blocker."}</div>`;
    $("reviewBriefApprovals")?.addEventListener("click", scrollToApprovals);
  } catch (error) {
    $("briefStatus").textContent = `Brief unavailable: ${error.message}`;
  }
}

function renderCommandResult(data) {
  const operation = data.operation || data.enqueueResult?.operation || {};
  const operationId = data.operationId || operation.id || data.enqueueResult?.operationId || "—";
  const status = normalizeStatus(data.status || operation.status || "UNKNOWN");
  const approvalRequired = isApproval(operation) || APPROVAL_STATUSES.has(status) || operation.approvalRequired === true;
  const message = data.message || data.response?.message || (data.conversation ? data.response?.message : null) || "MILES accepted the request.";
  $("commandResult").innerHTML = `<div class="command-summary"><b>${esc(message)}</b><div class="command-meta"><span>Status: <strong>${esc(status)}</strong></span><span>Mission ID: <strong>${esc(operationId)}</strong></span><span>Approval required: <strong>${approvalRequired ? "Yes" : "No"}</strong></span></div>${operationId !== "—" ? `<a class="product-action secondary-action" href="/execution?operationId=${encodeURIComponent(operationId)}" target="_blank" rel="noopener">View Mission</a>` : ""}${approvalRequired ? `<button id="reviewCommandApproval" class="secondary">Review Approval</button>` : ""}</div>`;
  $("commandTechnicalJson").textContent = JSON.stringify(data, null, 2);
  $("commandTechnical").classList.remove("hidden");
  $("reviewCommandApproval")?.addEventListener("click", scrollToApprovals);
}

async function sendCommand() {
  const command = $("commandText").value.trim();
  if (!command) return;
  $("sendCommand").disabled = true;
  $("commandResult").textContent = "Sending command to MILES...";
  try {
    const data = await getJson("/api/command", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ command }) });
    renderCommandResult(data);
    await Promise.all([loadState(), loadBrief()]);
  } catch (error) {
    $("commandResult").textContent = `Command failed: ${error.message}`;
    $("commandTechnicalJson").textContent = JSON.stringify(error.data || { error:error.message }, null, 2);
    $("commandTechnical").classList.remove("hidden");
  } finally { $("sendCommand").disabled = false; }
}

async function applyApproval(operationId, action) {
  const operation = canonicalApprovals.find(item => item.id === operationId);
  if (!operation) return;
  let reason = "";
  if (action === "reject") reason = window.prompt("Reason for rejection (optional):", "") || "";
  if (action === "request-changes") {
    const value = window.prompt("What changes should MILES make before this comes back for approval?", "");
    if (value == null) return;
    reason = value.trim();
    if (!reason) { window.alert("Please enter the changes you want MILES to make."); return; }
  }
  const label = action === "approve" ? "Approving" : action === "reject" ? "Rejecting" : "Requesting changes for";
  const card = document.querySelector(`[data-operation-id="${CSS.escape(operationId)}"]`);
  if (card) card.classList.add("busy");
  try {
    const data = await getJson(`/api/operations/${encodeURIComponent(operationId)}/${action}`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ reason, instructions:reason })
    });
    window.alert(data.message || `${label} operation completed: ${data.status || "OK"}`);
    await Promise.all([loadState(), loadBrief()]);
  } catch (error) {
    window.alert(`${label} operation failed: ${error.message}`);
  } finally { if (card) card.classList.remove("busy"); }
}

$("approvals").addEventListener("click", event => {
  const button = event.target.closest("button[data-approval-action]");
  if (!button) return;
  applyApproval(button.dataset.operationId, button.dataset.approvalAction);
});
$("refreshBrief").addEventListener("click", () => Promise.all([loadState(), loadBrief()]));
$("refreshApprovals").addEventListener("click", () => Promise.all([loadState(), loadBrief()]));
$("sendCommand").addEventListener("click", sendCommand);
Promise.all([loadState(), loadBrief()]).catch(error => console.error(error));
setInterval(() => loadState().catch(()=>{}), 60000);
