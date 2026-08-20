"use strict";

let currentOperationId = null;
let pollTimer = null;

const elements = {
  command: document.getElementById("cmd"),
  sendButton: document.getElementById("sendButton"),
  clearButton: document.getElementById("clearButton"),
  approveButton: document.getElementById("approveButton"),
  rejectButton: document.getElementById("rejectButton"),
  refreshButton: document.getElementById("refreshButton"),
  systemStatus: document.getElementById("systemStatus"),
  responseBadge: document.getElementById("responseBadge"),
  output: document.getElementById("out"),
  approvalActions: document.getElementById("approvalActions"),
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

function setBadge(status) {
  const normalized = normalizeStatus(status);
  elements.responseBadge.textContent = normalized;
  elements.responseBadge.className = "badge " + badgeClass(normalized);
}

function setBusy(isBusy, message) {
  elements.sendButton.disabled = isBusy;
  elements.approveButton.disabled = isBusy;
  elements.rejectButton.disabled = isBusy;
  elements.refreshButton.disabled = isBusy;
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
  const status = data.status || operation.status || latestTask.status || "UNKNOWN";
  elements.operationId.textContent = id || "—";
  elements.provider.textContent = provider || "—";
  elements.action.textContent = action || "—";
  elements.operationStatus.textContent = normalizeStatus(status);
  elements.operationSummary.classList.remove("hidden");
}

function updateApprovalControls(data) {
  const operation = data.operation || {};
  const status = normalizeStatus(operation.status || data.status);
  const requiresApproval = status === "AWAITING_APPROVAL" || status === "WAITING_FOR_CEO_APPROVAL";
  elements.approvalActions.classList.toggle("hidden", !requiresApproval);
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
  elements.systemStatus.textContent = status === "COMPLETED" ? "Operation completed" : "Miles is tracking the operation";
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

async function applyApproval(action) {
  if (!currentOperationId) return;
  const pastTense = action === "approve" ? "Approving" : "Rejecting";
  setBusy(true, pastTense + " operation");
  showMessage(pastTense.toUpperCase(), pastTense + " the current operation...");

  try {
    const data = await requestJson(
      "/api/operations/" + encodeURIComponent(currentOperationId) + "/" + action,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "" })
      }
    );

    renderResponse({
      ...data,
      operationId: currentOperationId,
      status: data.status || (action === "approve" ? "APPROVED" : "REJECTED"),
      message: data.message || (action === "approve" ? "Operation approved." : "Operation rejected.")
    });

    if (action === "approve") startPolling(currentOperationId);
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

function clearCommand() {
  elements.command.value = "";
  elements.command.focus();
}

elements.sendButton.addEventListener("click", sendCommand);
elements.clearButton.addEventListener("click", clearCommand);
elements.approveButton.addEventListener("click", () => applyApproval("approve"));
elements.rejectButton.addEventListener("click", () => applyApproval("reject"));
elements.refreshButton.addEventListener("click", () => pollOperation(currentOperationId));
elements.command.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendCommand();
  }
});
window.addEventListener("beforeunload", clearPolling);

setBadge("READY");
elements.systemStatus.textContent = "Miles is ready";