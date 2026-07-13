"use strict";

/*
==========================================================
 MILES OS
 BUILD_043
 Autonomous Capability Builder Service
 Version: 1.0.0
==========================================================
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendJsonl(file, data) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(data) + "\n");
}

class AutonomousCapabilityBuilderService {
  constructor() {
    this.name = "AUTONOMOUS_CAPABILITY_BUILDER";
    this.version = "1.0.0";
    this.outputDir = path.join(ROOT, "DATA", "capability_builder");
  }

  run() {
    ensureDir(this.outputDir);

    const inputs = this.loadInputs();
    const assessment = this.assess(inputs);
    const candidate = this.selectCandidate(inputs, assessment);
    const plan = this.createImplementationPlan(candidate, inputs, assessment);
    const artifacts = this.generateArtifacts(candidate, plan);
    const approvalPackage = this.createApprovalPackage(candidate, plan, artifacts, assessment);

    writeJson(path.join(this.outputDir, "latest_builder_assessment.json"), assessment);
    writeJson(path.join(this.outputDir, "latest_build_candidate.json"), candidate);
    writeJson(path.join(this.outputDir, "latest_implementation_plan.json"), plan);
    writeJson(path.join(this.outputDir, "latest_generated_artifacts.json"), artifacts);
    writeJson(path.join(this.outputDir, "latest_approval_package.json"), approvalPackage);

    appendJsonl(path.join(this.outputDir, "build_queue.jsonl"), {
      timestamp: now(),
      status: "PENDING_APPROVAL",
      buildId: approvalPackage.buildId,
      capability: candidate.name,
      approvalRequired: true
    });

    appendJsonl(path.join(this.outputDir, "build_history.jsonl"), {
      timestamp: now(),
      event: "BUILD_PACKAGE_GENERATED",
      buildId: approvalPackage.buildId,
      capability: candidate.name
    });

    return {
      ok: true,
      service: this.name,
      version: this.version,
      generatedAt: now(),
      buildId: approvalPackage.buildId,
      selectedCapability: candidate.name,
      status: "PENDING_APPROVAL"
    };
  }

  loadInputs() {
    return {
      capabilityBacklog: readJson(path.join(ROOT, "DATA", "capability_backlog", "latest_capability_backlog.json"), {}),
      repairPlan: readJson(path.join(ROOT, "DATA", "autonomous_repair", "latest_repair_plan.json"), {}),
      missionPlan: readJson(path.join(ROOT, "DATA", "executive", "latest_mission_plan.json"), {}),
      universalHealth: readJson(path.join(ROOT, "DATA", "executive", "latest_universal_health.json"), {}),
      latestCooCycle: readJson(path.join(ROOT, "DATA", "runtime", "latest_coo_cycle.json"), {})
    };
  }

  assess(inputs) {
    return {
      ok: true,
      service: this.name,
      generatedAt: now(),
      autonomyGoal: "Move from Assisted Autonomous COO toward Self-Planning Digital COO",
      inputsFound: {
        capabilityBacklog: !!inputs.capabilityBacklog,
        repairPlan: !!inputs.repairPlan,
        missionPlan: !!inputs.missionPlan,
        universalHealth: !!inputs.universalHealth,
        latestCooCycle: !!inputs.latestCooCycle
      },
      governance: {
        productionDeploymentAllowed: false,
        approvalRequiredBeforeDeployment: true,
        kevinApprovalRequired: true
      }
    };
  }

  selectCandidate(inputs, assessment) {
    const defaultCandidates = [
      {
        name: "Website COO",
        businessPriority: 90,
        revenueImpact: 85,
        technicalReadiness: 70,
        risk: 35
      },
      {
        name: "Sales COO",
        businessPriority: 95,
        revenueImpact: 95,
        technicalReadiness: 65,
        risk: 40
      },
      {
        name: "LinkedIn COO",
        businessPriority: 80,
        revenueImpact: 75,
        technicalReadiness: 60,
        risk: 45
      },
      {
        name: "Government Data COO",
        businessPriority: 90,
        revenueImpact: 90,
        technicalReadiness: 75,
        risk: 50
      }
    ];

    const scored = defaultCandidates.map(c => {
      const score =
        c.businessPriority * 0.35 +
        c.revenueImpact * 0.30 +
        c.technicalReadiness * 0.20 -
        c.risk * 0.15;

      return {
        ...c,
        score: Math.round(score)
      };
    }).sort((a, b) => b.score - a.score);

    const selected = scored[0];

    return {
      ok: true,
      generatedAt: now(),
      name: selected.name,
      score: selected.score,
      status: "SELECTED_FOR_PLANNING",
      reason: "Highest combined score across business priority, revenue impact, technical readiness, and governance risk.",
      scoring: scored,
      sourceInputs: [
        "latest_capability_backlog.json",
        "latest_repair_plan.json",
        "latest_mission_plan.json",
        "latest_universal_health.json",
        "latest_coo_cycle.json"
      ]
    };
  }

  createImplementationPlan(candidate) {
    return {
      ok: true,
      generatedAt: now(),
      capability: candidate.name,
      status: "PLAN_GENERATED",
      deploymentStatus: "NOT_DEPLOYED",
      approvalRequired: true,
      phases: [
        "Define capability contract",
        "Generate service skeleton",
        "Generate data outputs",
        "Generate tests",
        "Generate documentation",
        "Package approval request",
        "Wait for Kevin approval"
      ],
      proposedFiles: [
        `SERVICES/${candidate.name.replace(/\s+/g, "")}Service.js`,
        `DATA/capability_builder/staged/${candidate.name.replace(/\s+/g, "_").toLowerCase()}_plan.json`,
        `DOCS/${candidate.name.replace(/\s+/g, "_").toLowerCase()}_operations.md`
      ],
      testsRequired: [
        "Service loads without error",
        "Output files are generated",
        "No production deployment occurs without approval",
        "Approval package is created"
      ],
      rollbackPlan: "Delete staged generated files and remove pending build queue entry before approval."
    };
  }

  generateArtifacts(candidate, plan) {
    return {
      ok: true,
      generatedAt: now(),
      capability: candidate.name,
      status: "ARTIFACTS_STAGED_ONLY",
      productionModified: false,
      artifacts: plan.proposedFiles.map(file => ({
        file,
        action: "PROPOSE_CREATE",
        staged: true
      }))
    };
  }

  createApprovalPackage(candidate, plan, artifacts, assessment) {
    const buildId = `BUILD_043_${Date.now()}`;

    return {
      ok: true,
      buildId,
      generatedAt: now(),
      status: "PENDING_APPROVAL",
      approvalRequiredFrom: "Kevin",
      capability: candidate.name,
      summary: `MILES recommends building ${candidate.name} next.`,
      reason: candidate.reason,
      score: candidate.score,
      affectedFiles: artifacts.artifacts,
      risks: [
        "Generated capability may require manual review before production use.",
        "External system access may require credentials or approval.",
        "No production deployment should occur until Kevin approves."
      ],
      testsRequired: plan.testsRequired,
      rollbackPlan: plan.rollbackPlan,
      governance: assessment.governance
    };
  }
}

const service = new AutonomousCapabilityBuilderService();

/*
 * Legacy compatibility API.
 * Older connectors expect:
 *    builder.execute(payload)
 */
service.execute = async function (payload = {}) {
    return this.run(payload);
};

module.exports = service;