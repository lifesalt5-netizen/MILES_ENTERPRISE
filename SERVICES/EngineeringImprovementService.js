"use strict";

/*
  MILES OS
  File: SERVICES/EngineeringImprovementService.js
  Purpose:
    Controlled engineering improvement workflow.

  This service does NOT directly modify production files.
  It analyzes, plans, creates a controlled proposal package,
  validates assumptions, and reports to the CEO.
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readText(filePath) {
  try {
    if (!exists(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

class EngineeringImprovementService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;

    this.reportDir = path.join(
      this.rootDir,
      "DATA",
      "engineering_improvements"
    );

    this.proposalDir = path.join(
      this.reportDir,
      "proposals"
    );

    this.requiredFiles = [
      "SERVICES/CommandIntentPlannerService.js",
      "SERVICES/ExecutionService.js",
      "SERVICES/EngineeringImprovementService.js",
      "SERVICES/SelfMaintenanceService.js",
      "SERVICES/digital_coo/MilesCommandCenter.js",
      "SERVICES/ExecutiveResponseService.js",
      "BUILDER/BuilderService.js",
      "BUILDER/index.js",
      "CONNECTORS/MILES/connector.js",
      "CORE/TaskQueue.js",
      "CORE/ConnectorManager.js"
    ];
  }

  getObjective(task = {}) {
    const payload = task.payload || {};
    const plan = payload.plan || task.plan || {};

    return (
      plan.objective ||
      plan.originalCommand ||
      payload.objective ||
      payload.command ||
      task.objective ||
      task.command ||
      task.title ||
      ""
    );
  }

  filePath(relativePath) {
    return path.join(this.rootDir, relativePath);
  }

  inspectFile(relativePath) {
    const fullPath = this.filePath(relativePath);
    const text = readText(fullPath);

    return {
      file: relativePath,
      exists: exists(fullPath),
      size: text.length,
      hasModuleExport: /module\.exports/.test(text),
      hasExecute: /execute\s*\(/.test(text),
      hasRun: /run\s*\(/.test(text),
      hasPlan: /plan\s*\(/.test(text),
      hasKeywordRouting:
        /PROVIDER_BY_CAPABILITY|resolveProvider|\/orion|\/website|\/instantly/i.test(text),
      hasEngineeringImprovement: /ENGINEERING_IMPROVEMENT/.test(text),
      hasSelfMaintenance: /SELF_MAINTENANCE/.test(text),
      checkedAt: now()
    };
  }

  analyze(task = {}) {
    const objective = this.getObjective(task);
    const files = this.requiredFiles.map((file) => this.inspectFile(file));
    const findings = [];

    const planner = files.find(
      (f) => f.file === "SERVICES/CommandIntentPlannerService.js"
    );

    const execution = files.find(
      (f) => f.file === "SERVICES/ExecutionService.js"
    );

    const builder = files.find(
      (f) => f.file === "BUILDER/BuilderService.js"
    );

    if (planner && planner.hasKeywordRouting) {
      findings.push({
        severity: "HIGH",
        area: "Planner",
        file: planner.file,
        issue: "CommandIntentPlannerService still contains keyword/regex routing.",
        evidence:
          "Planner inspection detected provider/action routing expressions such as regex-based ORION, Website, Instantly, or resolveProvider logic.",
        recommendation:
          "Preserve working behavior but isolate keyword matching behind intent-first classification. Engineering directives must remain highest priority."
      });
    }

    if (execution && execution.hasKeywordRouting) {
      findings.push({
        severity: "HIGH",
        area: "Execution",
        file: execution.file,
        issue: "ExecutionService appears to contain provider inference.",
        evidence:
          "Execution inspection detected provider routing patterns that should not exist in execution.",
        recommendation:
          "ExecutionService should consume the planner output and avoid provider selection."
      });
    }

    if (builder && !builder.hasEngineeringImprovement) {
      findings.push({
        severity: "HIGH",
        area: "Builder",
        file: builder.file,
        issue: "BuilderService does not expose ENGINEERING_IMPROVEMENT.",
        evidence:
          "BuilderService does not contain the ENGINEERING_IMPROVEMENT action.",
        recommendation:
          "Register ENGINEERING_IMPROVEMENT and related engineering actions in BuilderService."
      });
    }

    if (builder && !builder.hasSelfMaintenance) {
      findings.push({
        severity: "MEDIUM",
        area: "Builder",
        file: builder.file,
        issue: "BuilderService does not expose SELF_MAINTENANCE.",
        evidence:
          "BuilderService does not contain SELF_MAINTENANCE.",
        recommendation:
          "Register SELF_MAINTENANCE so MILES can diagnose its own health."
      });
    }

    return {
      ok: true,
      service: "EngineeringImprovementService",
      action: "ENGINEERING_ANALYZE",
      objective,
      files,
      findings,
      checkedAt: now()
    };
  }

  plan(task = {}) {
    const analysis = this.analyze(task);

    const steps = [
      {
        step: 1,
        action: "ENGINEERING_ANALYZE",
        description:
          "Inspect active MILES runtime files and identify architectural gaps."
      },
      {
        step: 2,
        action: "ENGINEERING_PLAN",
        description:
          "Create the smallest safe implementation plan while preserving production architecture."
      },
      {
        step: 3,
        action: "ENGINEERING_IMPLEMENT",
        description:
          "Create a controlled proposal package. Do not modify production files directly."
      },
      {
        step: 4,
        action: "ENGINEERING_VALIDATE",
        description:
          "Validate required files, routing assumptions, builder support, and implementation readiness."
      },
      {
        step: 5,
        action: "ENGINEERING_REPORT",
        description:
          "Return an executive engineering report with evidence and recommended next action."
      }
    ];

    const recommendations = analysis.findings.map((finding) => ({
      area: finding.area,
      file: finding.file,
      severity: finding.severity,
      issue: finding.issue,
      recommendedAction: finding.recommendation
    }));

    return {
      ok: true,
      service: "EngineeringImprovementService",
      action: "ENGINEERING_PLAN",
      objective: analysis.objective,
      status: recommendations.length ? "PLAN_CREATED" : "NO_ACTION_REQUIRED",
      steps,
      recommendations,
      plannedAt: now()
    };
  }

  determineTargetFiles(objective = "") {
    const text = String(objective || "").toLowerCase();
    const targets = new Set();

    if (
      /planner|intent|routing|classif|commandintentplanner/.test(text)
    ) {
      targets.add("SERVICES/CommandIntentPlannerService.js");
    }

    if (
      /execution|executionservice|connector selection|connector routing/.test(text)
    ) {
      targets.add("SERVICES/ExecutionService.js");
    }

    if (
      /builder|unsupported action|builder action|capability/.test(text)
    ) {
      targets.add("BUILDER/BuilderService.js");
    }

    if (
      /health|maintenance|degraded|self maintenance|diagnose/.test(text)
    ) {
      targets.add("SERVICES/SelfMaintenanceService.js");
      targets.add("BUILDER/BuilderService.js");
    }

    if (
      /command center|ui|response|executive response/.test(text)
    ) {
      targets.add("SERVICES/digital_coo/MilesCommandCenter.js");
      targets.add("SERVICES/ExecutiveResponseService.js");
    }

    if (!targets.size) {
      targets.add("SERVICES/CommandIntentPlannerService.js");
      targets.add("SERVICES/ExecutionService.js");
      targets.add("BUILDER/BuilderService.js");
    }

    return Array.from(targets);
  }

  createProposal(task = {}) {
    const objective = this.getObjective(task);
    const analysis = this.analyze(task);
    const plan = this.plan(task);
    const targetFiles = this.determineTargetFiles(objective);

    const proposalId = `proposal_${Date.now()}`;
    const proposalPath = path.join(this.proposalDir, `${proposalId}.json`);

    const proposedChanges = targetFiles.map((relativePath) => {
      const fullPath = this.filePath(relativePath);
      const currentText = readText(fullPath);

      return {
        file: relativePath,
        exists: exists(fullPath),
        currentSize: currentText.length,
        proposedChangeType: exists(fullPath) ? "REPLACE_FILE" : "CREATE_FILE",
        productionWriteAllowed: false,
        reason:
          "Controlled engineering proposal only. Production replacement requires CEO approval.",
        validationCommand:
          relativePath.endsWith(".js")
            ? `node --check .\\${relativePath.replace(/\//g, "\\")}`
            : null
      };
    });

    const proposal = {
      ok: true,
      service: "EngineeringImprovementService",
      action: "ENGINEERING_IMPLEMENT",
      proposalId,
      objective,
      status: "PROPOSAL_CREATED",
      productionModified: false,
      approvalRequired: true,
      safeMode: true,
      executiveSummary:
        "Engineering proposal package created. No production files were modified.",
      analysis,
      plan,
      proposedChanges,
      validationCommands: proposedChanges
        .map((c) => c.validationCommand)
        .filter(Boolean),
      approvalInstructions:
        "Review this proposal. If approved, request a full replacement script for each target file.",
      createdAt: now()
    };

    writeJson(proposalPath, proposal);

    return {
      ...proposal,
      proposalPath
    };
  }

  implement(task = {}) {
    return this.createProposal(task);
  }

  validate(task = {}) {
    const files = this.requiredFiles.map((file) => this.inspectFile(file));

    const missing = files.filter((f) => !f.exists);
    const invalidExports = files.filter(
      (f) =>
        f.exists &&
        !f.hasModuleExport &&
        f.file !== "SERVICES/digital_coo/MilesCommandCenter.js"
    );

    const builderText = readText(this.filePath("BUILDER/BuilderService.js"));
    const plannerText = readText(
      this.filePath("SERVICES/CommandIntentPlannerService.js")
    );
    const executionText = readText(
      this.filePath("SERVICES/ExecutionService.js")
    );

    const validation = {
      requiredFilesPresent: missing.length === 0,
      moduleExportsValid: invalidExports.length === 0,
      builderHasEngineeringImprovement:
        /ENGINEERING_IMPROVEMENT/.test(builderText),
      builderHasSelfMaintenance:
        /SELF_MAINTENANCE/.test(builderText),
      plannerRecognizesEngineering:
        /ENGINEERING_IMPROVEMENT/.test(plannerText),
      executionHasNoProviderByCapability:
        !/PROVIDER_BY_CAPABILITY/.test(executionText),
      executionHasConnectorDispatch:
        /executeConnectorTask/.test(executionText)
    };

    return {
      ok: Object.values(validation).every(Boolean),
      service: "EngineeringImprovementService",
      action: "ENGINEERING_VALIDATE",
      filesChecked: files.length,
      missingFiles: missing,
      filesWithoutModuleExports: invalidExports,
      validation,
      validationStatus:
        Object.values(validation).every(Boolean) ? "PASSED" : "FAILED",
      checkedAt: now()
    };
  }

  report(task = {}) {
    const analysis = this.analyze(task);
    const plan = this.plan(task);
    const implementation = this.implement(task);
    const validation = this.validate(task);

    const report = {
      ok: true,
      service: "EngineeringImprovementService",
      action: "ENGINEERING_REPORT",
      objective: this.getObjective(task),
      executiveSummary:
        "MILES engineering workflow executed. The service analyzed the runtime, generated a safe implementation proposal, validated key files, and produced this report.",
      rootCauseSummary:
        analysis.findings.length
          ? "One or more engineering issues remain. See findings for evidence and recommended fixes."
          : "No high-priority engineering issues were detected in the inspected files.",
      findings: analysis.findings,
      improvementPlan: plan.steps,
      implementation,
      validation,
      recommendedNextAction:
        implementation.approvalRequired
          ? "Review the engineering proposal package and approve specific replacement scripts before production modification."
          : "Continue normal operations.",
      completedAt: now()
    };

    const outFile = path.join(
      this.reportDir,
      `engineering_report_${Date.now()}.json`
    );

    writeJson(outFile, report);

    return {
      ...report,
      outFile
    };
  }

  run(task = {}) {
    const action = String(
      task.action ||
      task.type ||
      task.payload?.action ||
      task.payload?.plan?.action ||
      "ENGINEERING_IMPROVEMENT"
    ).toUpperCase();

    if (action === "ENGINEERING_ANALYZE") return this.analyze(task);
    if (action === "ENGINEERING_PLAN") return this.plan(task);
    if (action === "ENGINEERING_IMPLEMENT") return this.implement(task);
    if (action === "ENGINEERING_VALIDATE") return this.validate(task);
    if (action === "ENGINEERING_REPORT") return this.report(task);
        // BUILD122B - Action aliases for planner-generated engineering tasks
    if (action === "ENGINEERING_REPAIR")
      return this.implement(task);

    if (action === "CAPABILITY_GAP_REVIEW")
      return this.analyze(task);

    if (action === "ENGINEERING_IMPROVEMENT") {
      const analysis = this.analyze(task);
      const plan = this.plan(task);
      const implementation = this.implement(task);
      const validation = this.validate(task);
      const report = this.report(task);

      return {
        ok: true,
        service: "EngineeringImprovementService",
        action: "ENGINEERING_IMPROVEMENT",
        objective: this.getObjective(task),
        status: "COMPLETED",
        productionModified: false,
        approvalRequired: true,
        analysis,
        plan,
        implementation,
        validation,
        report,
        completedAt: now()
      };
    }
supportedActions: [
  "ENGINEERING_IMPROVEMENT",
  "ENGINEERING_ANALYZE",
  "ENGINEERING_PLAN",
  "ENGINEERING_IMPLEMENT",
  "ENGINEERING_VALIDATE",
  "ENGINEERING_REPORT",
  "ENGINEERING_REPAIR",
  "CAPABILITY_GAP_REVIEW"
]
    return {
      ok: false,
      service: "EngineeringImprovementService",
      action,
      error: `Unsupported engineering action: ${action}`,
      supportedActions: [
        "ENGINEERING_IMPROVEMENT",
        "ENGINEERING_ANALYZE",
        "ENGINEERING_PLAN",
        "ENGINEERING_IMPLEMENT",
        "ENGINEERING_VALIDATE",
        "ENGINEERING_REPORT"
      ]
    };
  }
}

module.exports = new EngineeringImprovementService();