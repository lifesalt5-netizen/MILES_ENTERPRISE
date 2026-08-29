"use strict";

let currentOperationId = null;
let pollTimer = null;
let approvalRefreshTimer = null;

const elements = {
  command: document.getElementById("cmd"),
  sendButton: document.getElementById("sendButton"),
  clearButton: document.getElementById("clearButton"),
  approveButton: document.getElementById("approveButton"),
  rejectButton: document.getElementById("rejectButton"),
  refreshButton: document.getElementById("refreshButton"),
  refreshApprovalsButton: document.getElementById("refreshApprovalsButton"),
  systemStatus: document.getElementById("systemStatus"),
  responseBadge: document.getElementById("responseBadge"),
  output: document.getElementById("out"),
  approvalActions: document.getElementById("approvalActions"),
  approvalQueue: document.getElementById("approvalQueue"),
  approvalCount: document.getElementById("approvalCount"),
  operationSummary: document.getElementById("operationSummary"),
  operationId: document.getElementById("operationId"),
  provider: document.getElementById("provider"),
  action: document.getElementById("action"),
  operationStatus: document.getElementById("operationStatus"),
  technicalDetails: document.getElementById("technicalDetails"),
  rawJson: document.getElementById("rawJson")
};

function normalizeStatus(status) {
  return String(status || "UNKNOWN").trim().toUpperCase();
}

function badgeClass(status) {
  return normalizeStatus(status)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function isAwaitingApprovalStatus(status) {
  return ["AWAITING_APPROVAL", "WAITING_FOR_CEO_APPROVAL", "AWAITING_CEO_APPROVAL"].includes(normalizeStatus(status));
}

function setBadge(status) {
  const normalized = normalizeStatus(status);
  elements.responseBadge.textContent = normalized;
  elements.responseBadge.className = "badge " + badgeClass(normalized);
}

function setBusy(isBusy, message) {
  elements.sendButton.disabled = isBusy;
  if (elements.approveButton) elements.approveButton.disabled = isBusy;
  if (elements.rejectButton) elements.rejectButton.disabled = isBusy;
  if (elements.refreshButton) elements.refreshButton.disabled = isBusy;
  if (elements.refreshApprovalsButton) elements.refreshApprovalsButton.disabled = isBusy;
  if (message) elements.systemStatus.textContent = message;
}

function showMessage(title, message) {
  elements.output.innerHTML = "";
  const heading = document.createElement("div");
  heading.className = "response-title";
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "response-message";
  body.textContent = message || "";
  elements.output.appendChild(heading);
  elements.output.appendChild(body);
}

function showTechnicalDetails(data) {
  elements.rawJson.textContent = JSON.stringify(data || {}, null, 2);
  elements.technicalDetails.classList.remove("hidden");
}

function updateOperationSummary(data) {
  const operation = data.operation || {};
  const latestTask = data.latestTask || {};
  const id = data.operationId || operation.id || currentOperationId || "";
  const provider = data.provider || operation.provider || latestTask.provider || "";
  const action = data.action || operation.action || latestTask.action || "";
  const status = data.status || latestTask.status || operation.status || "UNKNOWN";
  elements.operationId.textContent = id || "—";
  elements.provider.textContent = provider || "—";
  elements.action.textContent = action || "—";
  elements.operationStatus.textContent = normalizeStatus(status);
  elements.operationSummary.classList.remove("hidden");
}

function updateApprovalControls(data) {
  const operation = data.operation || {};
  const latestTask = data.latestTask || {};
  const statuses = [data.status, latestTask.status, operation.status].map(normalizeStatus);
  const requiresApproval = statuses.some(isAwaitingApprovalStatus);
  elements.approvalActions.classList.toggle("hidden", !requiresApproval);
}

function systemStatusMessage(status, data = {}) {
  const normalized = normalizeStatus(status);
  const mode = normalizeStatus(data.mode || (data.conversation ? "CONVERSATION" : ""));
  if (normalized === "CONVERSATION" || normalized === "ANSWERED" || normalized === "EXECUTIVE_RESPONSE" || mode === "CONVERSATION") {
    return "Miles answered your question";
  }
  if (normalized === "COMPLETED") return "Operation completed";
  if (normalized === "FAILED" || normalized === "ERROR") return "Operation failed";
  if (normalized === "REJECTED") return "Operation rejected";
  if (isAwaitingApprovalStatus(normalized)) return "Miles is waiting for your approval";
  return "Miles is tracking the operation";
}

function renderResponse(data) {
  const status = normalizeStatus(data.status);
  const response = data.response || {};
  const message = response.message || data.message || data.error || "Miles returned no message.";
  setBadge(status);
  showMessage(status, message);
  updateOperationSummary(data);
  updateApprovalControls(data);
  showTechnicalDetails(data);
  elements.systemStatus.textContent = systemStatusMessage(status, data);
}

function clearPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function shouldStopPolling(status) {
  const normalized = normalizeStatus(status);
  return ["COMPLETED", "FAILED", "ERROR", "REJECTED", "ANSWERED", "CONVERSATION"].includes(normalized);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error("Miles returned a non-JSON response with status " + response.status);
    error.status = response.status;
    error.data = { ok: false, status: "NON_JSON_RESPONSE", httpStatus: response.status };
    throw error;
  }

  if (!response.ok) {
    const error = new Error(data.error || data.message || "Request failed with status " + response.status);
    error.status = response.status;
    error.data = { ...data, httpStatus: response.status };
    throw error;
  }

  return data;
}

async function pollOperation(operationId) {
  if (!operationId) return;
  try {
    const data = await requestJson("/api/operation?id=" + encodeURIComponent(operationId));
    renderResponse(data);
    await loadApprovalQueue();
    if (shouldStopPolling(data.status)) clearPolling();
  } catch (error) {
    clearPolling();
    const details = error.data || { ok: false, status: "POLLING_ERROR", error: error.message };
    setBadge(details.status || "ERROR");
    showMessage("POLLING ERROR", details.error || details.message || error.message);
    showTechnicalDetails(details);
    elements.systemStatus.textContent = "Polling failed";
  }
}

function startPolling(operationId) {
  clearPolling();
  pollOperation(operationId);
  pollTimer = setInterval(() => pollOperation(operationId), 3000);
}

async function sendCommand() {
  const command = elements.command.value.trim();
  if (!command) {
    elements.command.focus();
    return;
  }

  setBusy(true, "Miles is processing your command");
  setBadge("PROCESSING");
  showMessage("PROCESSING", "Sending command to Miles...");

  try {
    const data = await requestJson("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command })
    });

    if (!data.ok) {
      const error = new Error(data.message || data.error || "Miles could not process the command.");
      error.data = data;
      throw error;
    }

    const status = normalizeStatus(data.status);
    const mode = normalizeStatus(data.mode);
    if (mode === "CONVERSATION" || status === "CONVERSATION" || status === "ANSWERED") {
      currentOperationId = null;
      clearPolling();
      renderResponse(data);
      return;
    }

    currentOperationId = data.operationId || (data.operation && data.operation.id) || null;
    renderResponse(data);
    await loadApprovalQueue();
    if (currentOperationId) startPolling(currentOperationId);
  } catch (error) {
    const details = error.data || { ok: false, status: "COMMAND_ERROR", error: error.message };
    const status = normalizeStatus(details.status || "ERROR");
    setBadge(status);
    showMessage(status === "ERROR" ? "COMMAND ERROR" : status, details.message || details.error || error.message);
    updateOperationSummary(details);
    updateApprovalControls(details);
    showTechnicalDetails(details);
    elements.systemStatus.textContent = "Command blocked or failed";
  } finally {
    setBusy(false);
  }
}

async function applyApproval(action, operationId = currentOperationId, reason = "") {
  if (!operationId) return;
  const pastTense = action === "approve" ? "Approving" : "Rejecting";
  setBusy(true, pastTense + " operation");
  showMessage(pastTense.toUpperCase(), pastTense + " the selected operation...");

  try {
    const data = await requestJson(
      "/api/operations/" + encodeURIComponent(operationId) + "/" + action,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      }
    );

    currentOperationId = operationId;
    renderResponse({
      ...data,
      operationId,
      status: data.status || (action === "approve" ? "APPROVED" : "REJECTED"),
      message: data.message || (action === "approve" ? "Operation approved and released to execution." : "Operation rejected.")
    });

    await loadApprovalQueue();
    if (action === "approve") startPolling(operationId);
    else clearPolling();
  } catch (error) {
    const details = error.data || { ok: false, status: action === "approve" ? "APPROVAL_ERROR" : "REJECTION_ERROR", error: error.message };
    setBadge(details.status || "ERROR");
    showMessage(action === "approve" ? "APPROVAL ERROR" : "REJECTION ERROR", details.message || details.error || error.message);
    showTechnicalDetails(details);
  } finally {
    setBusy(false);
  }
}

function approvalTitle(operation) {
  return operation.title || operation.objective || operation.command || operation.id || "Approval required";
}

function renderApprovalQueue(operations) {
  if (!elements.approvalQueue || !elements.approvalCount) return;
  const pending = (operations || []).filter(operation => isAwaitingApprovalStatus(operation && operation.status));
  elements.approvalCount.textContent = String(pending.length);
  elements.approvalQueue.innerHTML = "";

  if (!pending.length) {
    const empty = document.createElement("div");
    empty.className = "approval-empty";
    empty.textContent = "No CEO approvals are waiting.";
    elements.approvalQueue.appendChild(empty);
    return;
  }

  pending.forEach(operation => {
    const card = document.createElement("article");
    card.className = "approval-card";

    const header = document.createElement("div");
    header.className = "approval-card-header";

    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "APPROVAL REQUIRED";
    const title = document.createElement("h3");
    title.textContent = approvalTitle(operation);
    titleWrap.appendChild(eyebrow);
    titleWrap.appendChild(title);

    const status = document.createElement("span");
    status.className = "badge awaiting_approval";
    status.textContent = normalizeStatus(operation.status);

    header.appendChild(titleWrap);
    header.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "approval-meta";
    meta.innerHTML = [
      ["Operation", operation.id || "—"],
      ["Provider", operation.provider || "MILES"],
      ["Action", operation.action || operation.type || "—"],
      ["Department", operation.department || "—"],
      ["Created", operation.createdAt ? new Date(operation.createdAt).toLocaleString() : "—"]
    ].map(([label, value]) => `<div><span>${label}</span><strong>${String(value)}</strong></div>`).join("");

    const command = document.createElement("div");
    command.className = "approval-command";
    command.textContent = operation.command || operation.objective || "No command text was recorded.";

    const actions = document.createElement("div");
    actions.className = "approval-actions";

    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "secondary";
    detailsButton.textContent = "View Details";
    detailsButton.addEventListener("click", () => {
      currentOperationId = operation.id;
      renderResponse({
        ok: true,
        operationId: operation.id,
        operation,
        status: operation.status,
        provider: operation.provider,
        action: operation.action || operation.type,
        message: operation.command || operation.objective || approvalTitle(operation)
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.textContent = "Approve";
    approveButton.addEventListener("click", () => applyApproval("approve", operation.id));

    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "danger";
    rejectButton.textContent = "Reject";
    rejectButton.addEventListener("click", () => {
      const reason = window.prompt("Reason for rejection (optional):", "") || "";
      applyApproval("reject", operation.id, reason);
    });

    actions.appendChild(detailsButton);
    actions.appendChild(approveButton);
    actions.appendChild(rejectButton);

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(command);
    card.appendChild(actions);
    elements.approvalQueue.appendChild(card);
  });
}

async function loadApprovalQueue() {
  if (!elements.approvalQueue) return;
  try {
    const data = await requestJson("/api/dashboard");
    renderApprovalQueue(Array.isArray(data.operations) ? data.operations : []);
  } catch (error) {
    elements.approvalQueue.innerHTML = "";
    const failed = document.createElement("div");
    failed.className = "approval-empty approval-error";
    failed.textContent = "Approval queue could not be loaded: " + error.message;
    elements.approvalQueue.appendChild(failed);
  }
}

function clearCommand() {
  elements.command.value = "";
  elements.command.focus();
}

elements.sendButton.addEventListener("click", sendCommand);
elements.clearButton.addEventListener("click", clearCommand);
elements.approveButton.addEventListener("click", () => applyApproval("approve"));
elements.rejectButton.addEventListener("click", () => {
  const reason = window.prompt("Reason for rejection (optional):", "") || "";
  applyApproval("reject", currentOperationId, reason);
});
elements.refreshButton.addEventListener("click", () => pollOperation(currentOperationId));
if (elements.refreshApprovalsButton) elements.refreshApprovalsButton.addEventListener("click", loadApprovalQueue);
elements.command.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendCommand();
  }
});
window.addEventListener("beforeunload", () => {
  clearPolling();
  if (approvalRefreshTimer) clearInterval(approvalRefreshTimer);
});

setBadge("READY");
elements.systemStatus.textContent = "Miles is ready";
loadApprovalQueue();
approvalRefreshTimer = setInterval(loadApprovalQueue, 5000);
