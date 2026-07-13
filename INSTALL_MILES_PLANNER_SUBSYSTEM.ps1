# INSTALL_MILES_PLANNER_SUBSYSTEM.ps1
# Installs MILES Planner + Work Package + Workflow subsystem.
# Run from D:\P2GC_Intelligence\MILES_OS

param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (!(Test-Path $RepoRoot)) {
    throw "Repo root not found: $RepoRoot"
}

Set-Location $RepoRoot

New-Item -ItemType Directory -Force ".\SERVICES" | Out-Null
New-Item -ItemType Directory -Force ".\CONFIG\WORKFLOWS" | Out-Null
New-Item -ItemType Directory -Force ".\DATA\work_packages" | Out-Null

@'
{
  "version": "1.0.0",
  "approvalRequired": [
    "pricing_change",
    "client_proposal_send",
    "legal_commitment",
    "financial_commitment",
    "domain_dns_change",
    "website_publish",
    "external_email_send"
  ],
  "defaultWorkflowStatus": "QUEUED",
  "defaultOwner": "MILES",
  "priorityScale": {
    "CRITICAL": 100,
    "HIGH": 80,
    "MEDIUM": 50,
    "LOW": 25
  }
}
'@ | Set-Content ".\CONFIG\WORKFLOWS\planning_rules.json"

@'
const fs = require("fs");
const path = require("path");
const capabilityService = require("./CapabilityService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RULES_PATH = path.join(ROOT, "CONFIG", "WORKFLOWS", "planning_rules.json");

function loadRules() {
  if (!fs.existsSync(RULES_PATH)) return {};
  return JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
}

function inferPriority(objective = "") {
  const text = String(objective).toLowerCase();
  if (/urgent|critical|today|deadline|due|broken|failed|down/.test(text)) return "CRITICAL";
  if (/revenue|sales|client|proposal|dreamers|campaign|orion|instantly/.test(text)) return "HIGH";
  if (/review|improve|audit|update|check/.test(text)) return "MEDIUM";
  return "LOW";
}

class PlannerService {
  createPlan(objective, context = {}) {
    const rules = loadRules();
    const priority = context.priority || inferPriority(objective);
    const capabilityPlan = capabilityService.planObjective(objective);

    const requiredCapabilities = capabilityPlan.requiredCapabilities || [];
    const assignments = capabilityPlan.assignments || [];

    const steps = assignments.map((assignment, index) => {
      const best = assignment.candidates?.[0]?.employees?.[0] || null;

      return {
        step: index + 1,
        capability: assignment.capability,
        assignedTo: best ? best.employee : "MILES",
        department: best ? best.department : "Executive",
        status: "QUEUED",
        dependsOn: [],
        expectedOutput: `${assignment.capability} recommendation`,
        verification: `Verify ${assignment.capability} output is actionable and aligned with CEO rules.`
      };
    });

    return {
      ok: true,
      type: "PLAN",
      objective,
      priority,
      priorityScore: rules.priorityScale?.[priority] || 50,
      createdAt: new Date().toISOString(),
      owner: "MILES",
      context,
      requiredCapabilities,
      steps,
      approvalRequired: this.requiresApproval(objective),
      rulesVersion: rules.version || "unknown"
    };
  }

  requiresApproval(objective = "") {
    const text = String(objective).toLowerCase();
    return /price|pricing|proposal send|send proposal|legal|contract|spend|buy|dns|publish/.test(text);
  }
}

module.exports = new PlannerService();
'@ | Set-Content ".\SERVICES\PlannerService.js"

@'
const fs = require("fs");
const path = require("path");
const planner = require("./PlannerService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const PACKAGE_DIR = path.join(ROOT, "DATA", "work_packages");

function id() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `WP-${stamp}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

class WorkPackageService {
  create(objective, context = {}) {
    fs.mkdirSync(PACKAGE_DIR, { recursive: true });

    const plan = planner.createPlan(objective, context);
    const workPackage = {
      id: id(),
      objective,
      status: plan.approvalRequired ? "AWAITING_APPROVAL" : "QUEUED",
      owner: "MILES",
      priority: plan.priority,
      priorityScore: plan.priorityScore,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan,
      tasks: plan.steps,
      approvals: plan.approvalRequired ? [{
        required: true,
        reason: "CEO approval required by planning rules.",
        status: "PENDING"
      }] : [],
      results: [],
      verification: {
        required: true,
        status: "PENDING"
      }
    };

    this.save(workPackage);
    return workPackage;
  }

  save(workPackage) {
    fs.mkdirSync(PACKAGE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(PACKAGE_DIR, `${workPackage.id}.json`),
      JSON.stringify(workPackage, null, 2)
    );
  }

  list() {
    if (!fs.existsSync(PACKAGE_DIR)) return [];
    return fs.readdirSync(PACKAGE_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, f), "utf8")))
      .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  }

  get(packageId) {
    const file = path.join(PACKAGE_DIR, `${packageId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  update(packageId, patch = {}) {
    const current = this.get(packageId);
    if (!current) throw new Error(`Work package not found: ${packageId}`);

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.save(updated);
    return updated;
  }
}

module.exports = new WorkPackageService();
'@ | Set-Content ".\SERVICES\WorkPackageService.js"

@'
const workPackages = require("./WorkPackageService");
const taskManager = require("./TaskManager");

class WorkflowService {
  createWorkflow(objective, context = {}) {
    const wp = workPackages.create(objective, context);

    if (wp.status === "AWAITING_APPROVAL") {
      return {
        ok: true,
        status: "AWAITING_APPROVAL",
        workPackage: wp,
        message: "Work package created and awaiting CEO approval."
      };
    }

    const queuedTasks = [];

    for (const step of wp.tasks) {
      const task = taskManager.create(
        "WORKFORCE_STEP",
        {
          workPackageId: wp.id,
          objective: wp.objective,
          capability: step.capability,
          assignedTo: step.assignedTo,
          department: step.department,
          expectedOutput: step.expectedOutput,
          verification: step.verification,
          system: "MILES",
          action: `Execute workforce step: ${step.capability}`
        },
        wp.priorityScore
      );

      queuedTasks.push(task);
    }

    return {
      ok: true,
      status: "QUEUED",
      workPackage: wp,
      queuedTasks
    };
  }

  status() {
    const packages = workPackages.list();

    return {
      ok: true,
      total: packages.length,
      queued: packages.filter(p => p.status === "QUEUED").length,
      awaitingApproval: packages.filter(p => p.status === "AWAITING_APPROVAL").length,
      completed: packages.filter(p => p.status === "COMPLETED").length,
      active: packages.slice(0, 10)
    };
  }
}

module.exports = new WorkflowService();
'@ | Set-Content ".\SERVICES\WorkflowService.js"

Write-Host "MILES Planner Subsystem installed." -ForegroundColor Green
Write-Host "Test with:" -ForegroundColor Cyan
Write-Host "node -e `"console.log(JSON.stringify(require('./SERVICES/PlannerService').createPlan('Grow sales pipeline with email marketing and capture strategy'), null, 2))`""
Write-Host "node -e `"console.log(JSON.stringify(require('./SERVICES/WorkflowService').createWorkflow('Grow sales pipeline with email marketing and capture strategy'), null, 2))`""
