"use strict";

const state = {
  config: null,
  health: null,
  desktopStatus: null
};

const pageTitles = {
  home: "CEO Home",
  miles: "Ask MILES",
  approvals: "CEO Approvals",
  applications: "Applications",
  operations: "Operations"
};

const elements = {
  pageTitle: document.getElementById("pageTitle"),
  approvalBadge: document.getElementById("approvalBadge"),
  approvalCount: document.getElementById("approvalCount"),
  openWorkCount: document.getElementById("openWorkCount"),
  runtimeHealth: document.getElementById("runtimeHealth"),
  connectedSystems: document.getElementById("connectedSystems"),
  overallState: document.getElementById("overallState"),
  shellStatus: document.getElementById("shellStatus"),
  shellStatusDot: document.getElementById("shellStatusDot"),
  serviceHealthList: document.getElementById("serviceHealthList"),
  applicationGrid: document.getElementById("applicationGrid"),
  approvalList: document.getElementById("approvalList"),
  priorityContent: document.getElementById("priorityContent"),
  commandResult: document.getElementById("commandResult"),
  commandResultFull: document.getElementById("commandResultFull")
};

function getPath(object, paths, fallback = null) {
  for (const path of paths) {
    const value = path
      .split(".")
      .reduce((current, key) => current?.[key], object);

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return fallback;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Request failed with status ${response.status}`
    );
  }

  return data;
}

function switchSection(sectionName) {
  document.querySelectorAll(".page-section").forEach(section => {
    section.classList.toggle("active", section.id === sectionName);
  });

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.section === sectionName
    );
  });

  elements.pageTitle.textContent =
    pageTitles[sectionName] || "MILES Enterprise";
}

function normalizeApprovals(status) {
  const candidates = [
    status?.approvals,
    status?.approvalQueue,
    status?.approval_queue,
    status?.runtime?.approvals,
    status?.workforce?.approvals,
    status?.governance?.approvals
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (Array.isArray(candidate?.items)) {
      return candidate.items;
    }

    if (Array.isArray(candidate?.pending)) {
      return candidate.pending;
    }
  }

  return [];
}

function determineApprovalCount(status, approvals) {
  const count = getPath(
    status,
    [
      "approvalCount",
      "approvals.count",
      "approvals.pendingCount",
      "approvalQueue.count",
      "approval_queue.count",
      "runtime.approvalCount",
      "workforce.approvalCount"
    ],
    null
  );

  return Number.isFinite(Number(count))
    ? Number(count)
    : approvals.length;
}

function determineOpenWork(status) {
  return getPath(
    status,
    [
      "openWork",
      "openWorkCount",
      "work.open",
      "workforce.openWork",
      "workforce.queue.open",
      "queue.open",
      "runtime.openWork"
    ],
    "—"
  );
}

function determineRuntimeHealth(status) {
  return getPath(
    status,
    [
      "health",
      "runtime.health",
      "runtime.status",
      "system.health",
      "workforce.health"
    ],
    "UNKNOWN"
  );
}

function renderApplications() {
  const services = state.config?.services || {};

  const applications = [
    {
      title: "MILES Command Center",
      description: "Issue executive commands and supervise operations.",
      url: services.commandCenter,
      configured: true
    },
    {
      title: "Executive Dashboard",
      description: "Review company health, priorities, work, and alerts.",
      url: services.dashboard,
      configured: true
    },
    {
      title: "Desktop Operations",
      description: "Review operational and outbound system status.",
      url: services.desktop,
      configured: true
    },
    {
      title: "ORION Demo",
      description: "Open the ORION intelligence demonstration environment.",
      url: services.orionDemo,
      configured: Boolean(services.orionDemo)
    },
    {
      title: "Sub2Prime",
      description: "Open subcontractor-to-prime matching intelligence.",
      url: services.sub2Prime,
      configured: Boolean(services.sub2Prime)
    },
    {
      title: "Proposal Studio",
      description: "Open proposal development and compliance operations.",
      url: services.proposalStudio,
      configured: Boolean(services.proposalStudio)
    }
  ];

  elements.applicationGrid.innerHTML = applications
    .map(application => `
      <article class="application-card ${
        application.configured ? "" : "not-configured"
      }">
        <h3>${application.title}</h3>
        <p>${application.description}</p>

        <button
          class="${
            application.configured
              ? "primary-button"
              : "secondary-button"
          }"
          data-application-url="${application.url || ""}"
          ${application.configured ? "" : "disabled"}
        >
          ${
            application.configured
              ? "Open Application"
              : "URL Not Configured"
          }
        </button>
      </article>
    `)
    .join("");

  document
    .querySelectorAll("[data-application-url]")
    .forEach(button => {
      button.addEventListener("click", () => {
        const url = button.dataset.applicationUrl;

        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      });
    });
}

function renderServiceHealth() {
  const checks = state.health?.checks || [];

  const healthyCount = checks.filter(
    check => check.configured && check.healthy
  ).length;

  elements.connectedSystems.textContent = healthyCount;

  elements.serviceHealthList.innerHTML = checks
    .map(check => `
      <div class="service-row">
        <div>
          <strong>${check.name}</strong>
          <div>${check.url || "Not configured"}</div>
        </div>

        <div class="service-state ${
          check.healthy ? "healthy" : "unhealthy"
        }">
          ${
            !check.configured
              ? "NOT CONFIGURED"
              : check.healthy
                ? "ONLINE"
                : "OFFLINE"
          }
        </div>
      </div>
    `)
    .join("");

  const essentialServices = checks.filter(check =>
    [
      "Command Center",
      "Desktop UI",
      "Executive Dashboard",
      "MILES API"
    ].includes(check.name)
  );

  const essentialHealthy = essentialServices.every(
    check => check.healthy
  );

  elements.overallState.textContent =
    essentialHealthy ? "ONLINE" : "ATTENTION";

  elements.shellStatus.textContent =
    essentialHealthy
      ? "Core systems online"
      : "System attention required";

  elements.shellStatusDot.className =
    "status-dot " +
    (essentialHealthy ? "healthy" : "unhealthy");
}

function renderApprovals() {
  const approvals = normalizeApprovals(state.desktopStatus);
  const count = determineApprovalCount(
    state.desktopStatus,
    approvals
  );

  elements.approvalBadge.textContent = count;
  elements.approvalCount.textContent = count;

  if (!approvals.length) {
    elements.approvalList.innerHTML = `
      <div class="approval-card">
        <h4>No detailed approval records returned</h4>
        <p>
          The current status endpoint reports ${count} approval
          request(s), but did not return the records required to
          render actionable cards.
        </p>
        <p>
          Build 200 will next connect the authoritative approval
          queue directly to this screen.
        </p>
      </div>
    `;

    return;
  }

  elements.approvalList.innerHTML = approvals
    .map((approval, index) => {
      const id =
        approval.id ||
        approval.operationId ||
        approval.workItemId ||
        approval.work_id ||
        "";

      const title =
        approval.title ||
        approval.type ||
        approval.action ||
        `Approval ${index + 1}`;

      const reason =
        approval.reason ||
        approval.description ||
        approval.summary ||
        "CEO-protected action requires review.";

      return `
        <article class="approval-card">
          <h4>${title}</h4>
          <p>${reason}</p>

          <div class="approval-actions">
            <button
              class="primary-button approval-action"
              data-id="${id}"
              data-action="approve"
              ${id ? "" : "disabled"}
            >
              Approve
            </button>

            <button
              class="danger-button approval-action"
              data-id="${id}"
              data-action="reject"
              ${id ? "" : "disabled"}
            >
              Reject
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".approval-action").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;

      if (!id) return;

      button.disabled = true;
      button.textContent = "Processing...";

      try {
        await requestJson(
          `/api/operations/${encodeURIComponent(id)}/${action}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              source: "MILES_EXECUTIVE_SHELL",
              actor: "Kevin",
              decision: action.toUpperCase()
            })
          }
        );

        await refreshAll();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
        button.textContent =
          action === "approve" ? "Approve" : "Reject";
      }
    });
  });
}

function renderDesktopStatus() {
  const status = state.desktopStatus || {};

  elements.openWorkCount.textContent =
    determineOpenWork(status);

  elements.runtimeHealth.textContent =
    determineRuntimeHealth(status);

  elements.priorityContent.textContent =
    getPath(
      status,
      [
        "topPriority.title",
        "executive.topPriority.title",
        "executive.priority.title",
        "priority.title",
        "topPriority",
        "priority"
      ],
      "Increase safe revenue-producing operating coverage."
    );

  renderApprovals();
}

function formatCommandResponse(data) {
  const response =
    data.executiveResponse ||
    data.response ||
    data.message ||
    data.summary ||
    data.result ||
    data;

  if (typeof response === "string") {
    return response;
  }

  return JSON.stringify(response, null, 2);
}

async function submitCommand(command, resultElement) {
  resultElement.textContent = "MILES is working...";

  try {
    const data = await requestJson("/api/command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        command
      })
    });

    resultElement.textContent = formatCommandResponse(data);
  } catch (error) {
    resultElement.textContent = `Command failed: ${error.message}`;
  }
}

async function refreshAll() {
  try {
    const [config, health, desktopStatus] = await Promise.all([
      requestJson("/api/shell/config"),
      requestJson("/api/shell/health"),
      requestJson("/api/desktop/status").catch(error => ({
        error: error.message
      }))
    ]);

    state.config = config;
    state.health = health;
    state.desktopStatus = desktopStatus;

    renderApplications();
    renderServiceHealth();
    renderDesktopStatus();
  } catch (error) {
    elements.shellStatus.textContent = error.message;
    elements.shellStatusDot.className =
      "status-dot unhealthy";
  }
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    switchSection(button.dataset.section);
  });
});

document
  .getElementById("refreshButton")
  .addEventListener("click", refreshAll);

document
  .getElementById("refreshApprovalsButton")
  .addEventListener("click", refreshAll);

document
  .getElementById("openCommandCenterButton")
  .addEventListener("click", () => {
    const url = state.config?.services?.commandCenter;

    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  });

document
  .getElementById("commandForm")
  .addEventListener("submit", event => {
    event.preventDefault();

    const input = document.getElementById("commandInput");
    const command = input.value.trim();

    if (command) {
      submitCommand(command, elements.commandResult);
    }
  });

document
  .getElementById("commandFormFull")
  .addEventListener("submit", event => {
    event.preventDefault();

    const input = document.getElementById("commandInputFull");
    const command = input.value.trim();

    if (command) {
      submitCommand(command, elements.commandResultFull);
    }
  });

refreshAll();
setInterval(refreshAll, 30000);
