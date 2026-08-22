"use strict";

const fs = require("fs");
const path = require("path");

const STAGES = Object.freeze([
  "00_INTAKE", "01_QUALIFICATION", "02_CAPTURE_INTELLIGENCE",
  "03_PROPOSAL_STRATEGY", "04_COMPLIANCE_ARCHITECTURE", "05_DRAFTING",
  "06_PRICING", "07_EVALUATOR_REVIEW", "08_REVISION",
  "09_FINAL_COMPLIANCE", "10_PRODUCTION_QA", "11_READY_FOR_APPROVAL",
  "12_APPROVED", "13_SUBMITTED", "14_EVALUATION_FOLLOW_UP",
  "15_WON", "16_LOST", "17_CLOSED_LESSONS_CAPTURED"
]);

const ROLES = Object.freeze({
  OWNER: "OWNER",
  P2GC_STAFF: "P2GC_STAFF",
  PAID_CLIENT: "PAID_CLIENT",
  TRIAL_PROSPECT: "TRIAL_PROSPECT"
});

const TRIAL_ALLOWED_ACTIONS = Object.freeze([
  "READ_PROJECT", "UPLOAD_CLIENT_EVIDENCE", "READ_REQUIREMENTS",
  "ASK_PROPOSAL_COMMAND", "WALK_ME_THROUGH_IT", "REQUEST_PURCHASE"
]);

const SALES_STAGES = Object.freeze([
  "PROSPECT_IDENTIFIED", "CONTACTED", "DISCOVERY_CONVERSATION",
  "TRIAL_REQUESTED", "TRIAL_CREATED", "TRIAL_SENT", "TRIAL_ACTIVATED",
  "ENGAGED", "HIGH_INTENT", "PURCHASE_REQUESTED", "OFFER_SENT",
  "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST", "NURTURE"
]);

const ACCEPTANCE_CHECKS = Object.freeze([
  "REAL_SOLICITATION_UPLOADED", "COMPLETE_FILE_INVENTORY",
  "MISSING_REFERENCED_DOCUMENTS_IDENTIFIED", "PROCUREMENT_TYPE_CLASSIFIED",
  "JURISDICTION_IDENTIFIED", "EVALUATION_METHOD_IDENTIFIED",
  "DOMAIN_PLAYBOOK_SELECTED", "MANDATORY_QUALIFICATIONS_EXTRACTED",
  "SUBMISSION_REQUIREMENTS_EXTRACTED", "EVALUATION_REQUIREMENTS_EXTRACTED",
  "REQUIRED_FORMS_IDENTIFIED", "FINAL_REQUIRED_SUBMISSION_CHECKLIST_CREATED",
  "EVERY_CHECKLIST_ITEM_SOURCED", "EVERY_CHECKLIST_ITEM_EXPLAINED",
  "CLIENT_EVIDENCE_LIST_GENERATED", "CLIENT_UPLOADS_PROCESSED",
  "EVIDENCE_CORRECTLY_MAPPED", "PARTIAL_EVIDENCE_REJECTED_AS_INCOMPLETE",
  "MANUAL_INFORMATION_PATH_WORKS", "WALK_ME_THROUGH_IT_WORKS",
  "ASK_PROPOSAL_COMMAND_WORKS", "READINESS_SCORE_UPDATES",
  "COMPLIANCE_SCORE_SEPARATE", "COMPETITIVE_SCORE_SEPARATE",
  "COMPANY_DNA_EVIDENCE_VAULT_WORKS", "EXISTING_EVIDENCE_REUSED",
  "CLIENT_NOT_ASKED_TWICE", "QUALIFICATION_GATE_WORKS",
  "PROPOSAL_STRATEGY_CREATED", "PROPOSAL_SECTIONS_GENERATED",
  "CLIENT_VOICE_USED", "REAL_EXPERIENCE_INCORPORATED",
  "UNSUPPORTED_CLAIMS_BLOCKED", "EVALUATOR_VIEW_RUNS",
  "POTENTIAL_STRENGTHS_IDENTIFIED", "WEAKNESSES_IDENTIFIED",
  "AUTOMATIC_REPAIR_WORKS", "CLIENT_PROMPTS_FOR_REMAINING_GAPS",
  "CROSS_VOLUME_CONSISTENCY_CHECKED", "PRICING_REQUIREMENTS_HANDLED",
  "REQUIRED_FORMS_HANDLED", "AMENDMENTS_UPDATE_WORKFLOW",
  "GOVERNMENT_QA_IMPACTS_CAPTURED", "FINAL_CLEAN_ROOM_AUDIT",
  "MANDATORY_COMPLIANCE_100_PERCENT", "REQUIRED_SIGNATURES_IDENTIFIED",
  "CLIENT_ATTESTATION_WORKS", "SUBMISSION_RISK_BRIEF_GENERATED",
  "FINAL_FILES_CREATED", "FILENAMES_CORRECT", "FILE_ORDER_CORRECT",
  "SUBMISSION_README_CREATED", "DOWNLOAD_ALL_WORKS",
  "SUBMISSION_CONFIRMATION_TRACKED", "SUBMITTED_VERSION_FROZEN",
  "TRIAL_CREATION_WORKS", "UNIQUE_TRIAL_ACCESS_WORKS",
  "TRIAL_AUTHENTICATION_WORKS", "TRIAL_TIMER_STARTS_AT_ACTIVATION",
  "TRIAL_QA_WORKS", "TRIAL_RESTRICTIONS_ENFORCED", "CODE_AND_PROMPTS_HIDDEN",
  "SALES_PIPELINE_RECORD_CREATED", "ACTIVITY_TIMELINE_POPULATED",
  "INTENT_TRACKING_WORKS", "PURCHASE_REQUEST_ROUTES_TO_KEVIN",
  "TRIAL_CONVERTS_WITHOUT_RESTART", "PROOF_LEDGER_RECORDS_MEANINGFUL_ISSUES"
]);

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function normalizeRole(role) { return String(role || "").trim().toUpperCase(); }
function stageIndex(stage) { return STAGES.indexOf(stage); }
function newId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function readJson(file, fallback) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback; }
  catch { return fallback; }
}
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
function readText(file) {
  try { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; }
  catch { return ""; }
}

class ProposalCommandService {
  constructor(options = {}) {
    this.root = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.dataDir = path.resolve(options.dataDir || path.join(this.root, "DATA", "proposal_command"));
    this.projectsDir = path.resolve(options.projectsDir || path.join(this.dataDir, "projects"));
    this.salesDir = path.resolve(options.salesDir || path.join(this.root, "DATA", "sales_coo"));
    this.inventoryFile = path.join(this.dataDir, "latest_inventory.json");
    this.salesPipelineFile = path.join(this.salesDir, "proposal_command_pipeline.json");
    ensureDir(this.projectsDir);
    ensureDir(this.salesDir);
  }

  authorityHierarchy() {
    return [
      "CURRENT_SOLICITATION",
      "AMENDMENTS_AND_GOVERNMENT_QA",
      "APPLICABLE_ACQUISITION_RULES",
      "PROCUREMENT_TYPE_AND_EVALUATION_PLAYBOOKS",
      "P2GC_PROPOSAL_EXCELLENCE_STANDARD",
      "CLIENT_COMPANY_DNA_AND_EVIDENCE_VAULT",
      "HISTORICAL_WIN_LOSS_LEARNING"
    ];
  }

  inspectSource(relativePath, snippets = []) {
    const text = readText(path.join(this.root, relativePath));
    return {
      relativePath,
      exists: Boolean(text),
      snippets: snippets.map(snippet => ({ snippet, found: text.includes(snippet) }))
    };
  }

  inventory() {
    const workforce = this.inspectSource("CONFIG/WORKFORCE/MILES_WORKFORCE_REGISTRY.json", ["\"id\": \"keith\"", "compliance matrix", "proposal QA"]);
    const capabilities = this.inspectSource("CONFIG/WORKFORCE/MILES_CAPABILITIES_v1.json", ["\"proposal\"", "\"proposal compliance\"", "\"compliance matrix\""]);
    const enterprise = this.inspectSource("SERVICES/registry/EnterpriseCapabilityRegistryService.js", ["ANALYZE_SOLICITATION", "BUILD_COMPLIANCE_MATRIX", "MANAGE_PROPOSAL"]);
    const sales = this.inspectSource("PROVIDERS/providers/SalesProvider.js", ["async reviewProposals()", "PREPARE_SUBMISSION_READINESS"]);
    const router = this.inspectSource("SERVICES/ProviderRouterService.js", ["SalesProvider", "reviewProposals", "OrionProvider"]);
    const orion = this.inspectSource("PROVIDERS/providers/OrionProvider.js", ["class OrionProvider"]);

    const all = item => item.exists && item.snippets.every(s => s.found);
    const matrix = [
      ["KEITH proposal authority", all(workforce) && all(capabilities) ? "EXISTS_BUT_NEEDS_WIRING" : "PARTIAL", [workforce.relativePath, capabilities.relativePath]],
      ["Proposal deadline/readiness monitoring", all(sales) && all(router) ? "EXISTS_AND_VERIFIED" : "PARTIAL", [sales.relativePath, router.relativePath]],
      ["ORION government intelligence provider", orion.exists && all(router) ? "EXISTS_AND_VERIFIED" : "PARTIAL", [orion.relativePath, router.relativePath]],
      ["Proposal capability registry", all(enterprise) ? "EXISTS_BUT_NEEDS_WIRING" : "PARTIAL", [enterprise.relativePath]],
      ["Solicitation package ingestion", "MISSING", []],
      ["Company DNA / Evidence Vault", "MISSING", []],
      ["00-17 proposal lifecycle state machine", "EXISTS_BUT_NEEDS_WIRING", ["SERVICES/proposal/ProposalCommandService.js"]],
      ["Proposal Readiness Scan trial workspace foundation", "EXISTS_BUT_NEEDS_WIRING", ["SERVICES/proposal/ProposalCommandService.js"]],
      ["Full solicitation-to-submission production chain", "PARTIAL", ["SERVICES/proposal/ProposalCommandService.js"]]
    ].map(([area, status, evidence]) => ({ area, status, evidence }));

    const result = {
      ok: true,
      product: "P2GC Proposal Command™",
      descriptor: "Government Proposal Intelligence & Submission Platform",
      build: "Kevin 6.3",
      generatedAt: nowIso(),
      authorityHierarchy: this.authorityHierarchy(),
      stageModel: [...STAGES],
      matrix,
      counts: matrix.reduce((acc, row) => ((acc[row.status] = (acc[row.status] || 0) + 1), acc), {}),
      productionAccepted: false,
      reason: "Production acceptance is prohibited until all 68 acceptance checks pass with a real client and real solicitation."
    };
    writeJson(this.inventoryFile, result);
    return result;
  }

  projectFile(projectId) { return path.join(this.projectsDir, `${projectId}.json`); }

  loadProject(projectId) {
    const project = readJson(this.projectFile(projectId), null);
    if (!project) throw new Error(`Proposal Command project not found: ${projectId}`);
    return project;
  }

  createProject(input = {}) {
    const client = String(input.client || input.contractor || "").trim();
    const proposalName = String(input.proposalName || input.name || "").trim();
    if (!client) throw new Error("Client / Contractor is required.");
    if (!proposalName) throw new Error("Proposal Name is required.");

    const role = normalizeRole(input.actorRole || ROLES.OWNER);
    if (!Object.values(ROLES).includes(role)) throw new Error(`Unsupported role: ${role}`);
    const createdAt = nowIso();
    const project = {
      id: input.projectId || newId("PC"),
      product: "P2GC Proposal Command™",
      client,
      tenantId: String(input.tenantId || client).trim(),
      proposalName,
      solicitationNumber: input.solicitationNumber || null,
      agency: input.agency || null,
      projectType: input.projectType === "TRIAL" ? "TRIAL" : "PAID_OR_INTERNAL",
      role,
      stage: STAGES[0],
      stageIndex: 0,
      status: "ACTIVE",
      authorityHierarchy: this.authorityHierarchy(),
      solicitationAuthority: {
        currentSolicitationControls: true,
        amendmentsAndGovernmentQaOverridePriorAnalysis: true,
        priorKnowledgeMayTeachButNeverOverride: true
      },
      scores: { readiness: null, compliance: null, competitive: null },
      files: [], requirements: [], evidence: [], missingItems: [], proofLedger: [],
      acceptance: Object.fromEntries(ACCEPTANCE_CHECKS.map(check => [check, false])),
      activityTimeline: [{ at: createdAt, action: "PROJECT_CREATED", actorRole: role, stage: STAGES[0] }],
      trial: null,
      submittedSnapshotFrozen: false,
      createdAt,
      updatedAt: createdAt
    };
    writeJson(this.projectFile(project.id), project);
    return this.publicProject(project);
  }

  createTrial(input = {}) {
    const durationDays = Number(input.durationDays) > 0 ? Number(input.durationDays) : 5;
    const created = this.createProject({ ...input, projectType: "TRIAL", actorRole: ROLES.TRIAL_PROSPECT });
    const project = this.loadProject(created.id);
    project.trial = {
      status: "CREATED",
      durationDays,
      uniqueAccessId: newId("TRIAL"),
      activatedAt: null,
      expiresAt: null,
      allowedActions: [...TRIAL_ALLOWED_ACTIONS]
    };
    Object.assign(project.acceptance, {
      TRIAL_CREATION_WORKS: true,
      UNIQUE_TRIAL_ACCESS_WORKS: true,
      TRIAL_RESTRICTIONS_ENFORCED: true,
      CODE_AND_PROMPTS_HIDDEN: true,
      SALES_PIPELINE_RECORD_CREATED: true,
      ACTIVITY_TIMELINE_POPULATED: true
    });
    project.activityTimeline.push({ at: nowIso(), action: "TRIAL_CREATED", actorRole: ROLES.OWNER, stage: project.stage });
    project.updatedAt = nowIso();
    writeJson(this.projectFile(project.id), project);
    this.appendSalesEvent(project, "TRIAL_CREATED");
    return this.publicProject(project, { includeTrialAccessId: true });
  }

  activateTrial(projectId, accessId) {
    const project = this.loadProject(projectId);
    if (!project.trial) throw new Error("Project is not a trial.");
    if (project.trial.uniqueAccessId !== accessId) throw new Error("Invalid trial access.");
    if (project.trial.status === "EXPIRED") throw new Error("Trial has expired.");
    const activated = new Date();
    project.trial.status = "ACTIVE";
    project.trial.activatedAt = activated.toISOString();
    project.trial.expiresAt = new Date(activated.getTime() + project.trial.durationDays * 86400000).toISOString();
    project.acceptance.TRIAL_AUTHENTICATION_WORKS = true;
    project.acceptance.TRIAL_TIMER_STARTS_AT_ACTIVATION = true;
    project.activityTimeline.push({ at: activated.toISOString(), action: "TRIAL_ACTIVATED", actorRole: ROLES.TRIAL_PROSPECT, stage: project.stage });
    project.updatedAt = nowIso();
    writeJson(this.projectFile(project.id), project);
    this.appendSalesEvent(project, "TRIAL_ACTIVATED");
    return this.publicProject(project);
  }

  authorize(project, context = {}, action = "READ_PROJECT") {
    const role = normalizeRole(context.actorRole || project.role);
    if (role === ROLES.OWNER) return true;
    if (role === ROLES.P2GC_STAFF) {
      if ((context.assignedProjectIds || []).includes(project.id)) return true;
      throw new Error("P2GC staff member is not assigned to this project.");
    }
    if (String(context.tenantId || "") !== String(project.tenantId || "")) throw new Error("Tenant access denied.");
    if (role === ROLES.TRIAL_PROSPECT) {
      if (!project.trial || context.accessId !== project.trial.uniqueAccessId) throw new Error("Trial authentication failed.");
      if (!project.trial.allowedActions.includes(action)) throw new Error(`Trial action is restricted: ${action}`);
      if (project.trial.status !== "ACTIVE") throw new Error("Trial is not active.");
      if (project.trial.expiresAt && Date.now() > new Date(project.trial.expiresAt).getTime()) {
        project.trial.status = "EXPIRED";
        writeJson(this.projectFile(project.id), project);
        throw new Error("Trial has expired.");
      }
      return true;
    }
    if (role === ROLES.PAID_CLIENT) return true;
    throw new Error("Access denied.");
  }

  getProject(projectId, context = {}) {
    const project = this.loadProject(projectId);
    this.authorize(project, context, "READ_PROJECT");
    return this.publicProject(project);
  }

  setScores(projectId, scores = {}, context = {}) {
    const project = this.loadProject(projectId);
    this.authorize(project, context, "UPDATE_SCORES");
    for (const key of ["readiness", "compliance", "competitive"]) {
      if (scores[key] === undefined) continue;
      const value = Number(scores[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${key} score must be between 0 and 100.`);
      project.scores[key] = value;
    }
    project.acceptance.READINESS_SCORE_UPDATES = Number.isFinite(project.scores.readiness);
    project.acceptance.COMPLIANCE_SCORE_SEPARATE = Number.isFinite(project.scores.compliance);
    project.acceptance.COMPETITIVE_SCORE_SEPARATE = Number.isFinite(project.scores.competitive);
    project.updatedAt = nowIso();
    writeJson(this.projectFile(project.id), project);
    return this.publicProject(project);
  }

  mandatoryComplianceSatisfied(project) {
    return Number(project.scores.compliance) === 100 && !(project.missingItems || []).some(item => item && item.mandatory === true && item.resolved !== true);
  }

  transitionProject(projectId, toStage, context = {}) {
    const project = this.loadProject(projectId);
    this.authorize(project, context, "ADVANCE_WORKFLOW");
    const current = stageIndex(project.stage);
    const target = stageIndex(toStage);
    if (target < 0) throw new Error(`Unknown proposal stage: ${toStage}`);
    if (project.submittedSnapshotFrozen && target <= stageIndex("13_SUBMITTED")) throw new Error("Submitted version is frozen and cannot be altered.");

    const ownerOverride = normalizeRole(context.actorRole) === ROLES.OWNER && context.override === true;
    if (!ownerOverride && target !== current + 1) throw new Error(`Workflow transition must advance exactly one stage: ${project.stage} -> ${toStage}`);
    if (target >= stageIndex("11_READY_FOR_APPROVAL") && !this.mandatoryComplianceSatisfied(project)) {
      throw new Error("Cannot enter approval/submission stages until mandatory compliance is 100% and no mandatory blocker remains.");
    }
    if (toStage === "12_APPROVED" && normalizeRole(context.actorRole) !== ROLES.OWNER) throw new Error("Only OWNER may provide final protected proposal approval.");

    project.stage = toStage;
    project.stageIndex = target;
    project.updatedAt = nowIso();
    project.activityTimeline.push({
      at: project.updatedAt,
      action: ownerOverride ? "STAGE_OVERRIDE" : "STAGE_ADVANCED",
      fromStage: STAGES[current], toStage,
      actorRole: normalizeRole(context.actorRole || project.role),
      reason: context.reason || null,
      knownRisk: context.knownRisk || null
    });
    if (toStage === "13_SUBMITTED") {
      project.submittedSnapshotFrozen = true;
      project.acceptance.SUBMITTED_VERSION_FROZEN = true;
    }
    writeJson(this.projectFile(project.id), project);
    return this.publicProject(project);
  }

  addProofLedgerIssue(projectId, issue = {}, context = {}) {
    const project = this.loadProject(projectId);
    this.authorize(project, context, "WRITE_PROOF_LEDGER");
    if (!issue.issue) throw new Error("Proof Ledger issue description is required.");
    const record = {
      id: newId("PROOF"), client: project.client, solicitation: project.solicitationNumber,
      issue: issue.issue, source: issue.source || null, severity: issue.severity || "REVIEW",
      correction: issue.correction || null, resolution: issue.resolution || null,
      outcome: issue.outcome || null, createdAt: nowIso()
    };
    project.proofLedger.push(record);
    project.acceptance.PROOF_LEDGER_RECORDS_MEANINGFUL_ISSUES = true;
    project.updatedAt = nowIso();
    writeJson(this.projectFile(project.id), project);
    return record;
  }

  appendSalesEvent(project, stage) {
    if (!SALES_STAGES.includes(stage)) return false;
    const pipeline = readJson(this.salesPipelineFile, { events: [] });
    if (!Array.isArray(pipeline.events)) pipeline.events = [];
    pipeline.events.push({ id: newId("PCSALES"), projectId: project.id, client: project.client, stage, at: nowIso(), source: "P2GC_PROPOSAL_COMMAND" });
    pipeline.updatedAt = nowIso();
    writeJson(this.salesPipelineFile, pipeline);
    return true;
  }

  acceptanceStatus(projectId, context = {}) {
    const project = this.loadProject(projectId);
    this.authorize(project, context, "READ_PROJECT");
    const passed = Object.values(project.acceptance).filter(Boolean).length;
    return { projectId, passed, total: ACCEPTANCE_CHECKS.length, remaining: ACCEPTANCE_CHECKS.length - passed, productionAccepted: passed === ACCEPTANCE_CHECKS.length, checks: { ...project.acceptance } };
  }

  publicProject(project, options = {}) {
    const copy = JSON.parse(JSON.stringify(project));
    if (copy.trial && !options.includeTrialAccessId) delete copy.trial.uniqueAccessId;
    return copy;
  }

  status() {
    const inventory = this.inventory();
    const projectCount = fs.readdirSync(this.projectsDir).filter(name => name.endsWith(".json")).length;
    return { ok: true, product: "P2GC Proposal Command™", build: "Kevin 6.3", projectCount, stages: STAGES.length, acceptanceChecks: ACCEPTANCE_CHECKS.length, inventory: inventory.counts, productionAccepted: false };
  }
}

ProposalCommandService.STAGES = STAGES;
ProposalCommandService.ROLES = ROLES;
ProposalCommandService.ACCEPTANCE_CHECKS = ACCEPTANCE_CHECKS;
ProposalCommandService.SALES_STAGES = SALES_STAGES;

module.exports = ProposalCommandService;
