"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .toUpperCase();
}

function normalizeRelative(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "governed-change";
}

class GovernedGitHubWorkflowService {
  constructor(options = {}) {
    this.service = "GOVERNED_GITHUB_WORKFLOW";
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..")
    );
    this.outputRoot = options.outputRoot || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "engineering",
      "github_workflows"
    );
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  readArtifact(filePath, label) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`${label}_MISSING`);
    }
    const buffer = fs.readFileSync(filePath);
    let value;
    try {
      value = JSON.parse(buffer.toString("utf8"));
    } catch (error) {
      throw new Error(`${label}_INVALID: ${error.message}`);
    }
    return { value, sha256: sha256(buffer), filePath: path.resolve(filePath) };
  }

  resolveSource(relativePath) {
    const normalized = normalizeRelative(relativePath);
    const segments = normalized.split("/");
    if (
      !normalized ||
      path.isAbsolute(relativePath) ||
      segments.includes("..") ||
      segments.includes(".")
    ) {
      throw new Error(`GITHUB_WORKFLOW_PATH_NOT_ALLOWED: ${relativePath}`);
    }
    const fullPath = path.resolve(this.rootDir, ...segments);
    const prefix = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;
    if (!fullPath.startsWith(prefix)) {
      throw new Error(`GITHUB_WORKFLOW_PATH_OUTSIDE_ROOT: ${relativePath}`);
    }
    return { relativePath: normalized, fullPath };
  }

  validatePlan(plan) {
    if (
      plan?.ok !== true ||
      !/^ENGINEERING-PLAN-[A-F0-9]{16}$/.test(plan.planId || "") ||
      !/^[A-F0-9]{64}$/.test(plan.planFingerprint || "") ||
      !/^[A-F0-9]{64}$/.test(plan.repository?.fingerprint || "") ||
      !Array.isArray(plan.scope?.targets) ||
      plan.scope.targets.length === 0
    ) {
      throw new Error("GITHUB_WORKFLOW_PLAN_INVALID");
    }
  }

  validateChain(plan, manifest, validation) {
    if (
      manifest?.ok !== true ||
      manifest.service !== "GOVERNED_CODE_MODIFICATION" ||
      manifest.status !== "APPLIED" ||
      manifest.sourceWritesPerformed !== true ||
      manifest.plan?.planId !== plan.planId ||
      manifest.plan?.planFingerprint !== plan.planFingerprint ||
      manifest.repositoryFingerprint !== plan.repository.fingerprint ||
      !Array.isArray(manifest.files) ||
      manifest.files.length === 0
    ) {
      throw new Error("GITHUB_WORKFLOW_MODIFICATION_INVALID");
    }
    if (
      validation?.ok !== true ||
      validation.service !== "GOVERNED_ENGINEERING_VALIDATION" ||
      validation.status !== "PASSED" ||
      validation.plan?.planId !== plan.planId ||
      validation.plan?.planFingerprint !== plan.planFingerprint ||
      validation.repositoryFingerprint !== plan.repository.fingerprint ||
      validation.modificationExecutionId !== manifest.executionId ||
      !/^[A-F0-9]{64}$/.test(validation.validationFingerprint || "")
    ) {
      throw new Error("GITHUB_WORKFLOW_VALIDATION_INVALID");
    }
    const boundaries = [manifest, validation];
    if (boundaries.some(item =>
      item.gitWritesPerformed !== false ||
      item.mergePerformed !== false ||
      item.deploymentPerformed !== false
    )) {
      throw new Error("GITHUB_WORKFLOW_AUTHORITY_BOUNDARY_VIOLATED");
    }
  }

  verifyFiles(plan, manifest) {
    const targets = new Set(
      plan.scope.targets.map(target => normalizeRelative(target.id))
    );
    const seen = new Set();
    return manifest.files.map(file => {
      const target = this.resolveSource(file.path);
      if (seen.has(target.relativePath)) {
        throw new Error(`GITHUB_WORKFLOW_DUPLICATE_FILE: ${file.path}`);
      }
      seen.add(target.relativePath);
      if (!targets.has(target.relativePath)) {
        throw new Error(`GITHUB_WORKFLOW_FILE_OUTSIDE_PLAN: ${file.path}`);
      }
      if (
        !/^[A-F0-9]{64}$/.test(file.afterSha256 || "") ||
        !fs.existsSync(target.fullPath) ||
        !fs.lstatSync(target.fullPath).isFile() ||
        fs.lstatSync(target.fullPath).isSymbolicLink()
      ) {
        throw new Error(`GITHUB_WORKFLOW_FILE_INVALID: ${file.path}`);
      }
      const actualSha256 = sha256(fs.readFileSync(target.fullPath));
      if (actualSha256 !== file.afterSha256) {
        throw new Error(`GITHUB_WORKFLOW_FILE_HASH_MISMATCH: ${file.path}`);
      }
      return {
        path: target.relativePath,
        sha256: actualSha256,
        bytes: fs.statSync(target.fullPath).size
      };
    }).sort((first, second) => first.path.localeCompare(second.path));
  }

  buildWorkflow(input = {}) {
    const planArtifact = this.readArtifact(input.planPath, "ENGINEERING_PLAN");
    const manifestArtifact = this.readArtifact(
      input.manifestPath,
      "CODE_MODIFICATION_MANIFEST"
    );
    const validationArtifact = this.readArtifact(
      input.validationPath,
      "ENGINEERING_VALIDATION_EVIDENCE"
    );
    const plan = planArtifact.value;
    const manifest = manifestArtifact.value;
    const validation = validationArtifact.value;
    this.validatePlan(plan);
    this.validateChain(plan, manifest, validation);
    const files = this.verifyFiles(plan, manifest);
    const suffix = plan.planId.slice(-8).toLowerCase();
    const objectiveSlug = slugify(plan.objective);
    const branch = `agent/miles-${objectiveSlug}-${suffix}`.slice(0, 90);
    const title = `MILES: ${String(plan.objective).trim()}`.slice(0, 120);
    const identity = {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      repositoryFingerprint: plan.repository.fingerprint,
      modificationExecutionId: manifest.executionId,
      validationId: validation.validationId,
      validationFingerprint: validation.validationFingerprint,
      files,
      base: "main",
      branch
    };
    const workflowFingerprint = sha256(
      Buffer.from(JSON.stringify(identity), "utf8")
    );
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      workflowId: `GITHUB-WORKFLOW-${workflowFingerprint.slice(0, 16)}`,
      workflowFingerprint,
      generatedAt: this.generatedAt(),
      objective: plan.objective,
      repository: {
        fingerprint: plan.repository.fingerprint,
        base: "main",
        branch
      },
      plan: {
        planId: plan.planId,
        planFingerprint: plan.planFingerprint
      },
      modification: {
        executionId: manifest.executionId,
        manifestSha256: manifestArtifact.sha256
      },
      validation: {
        validationId: validation.validationId,
        validationFingerprint: validation.validationFingerprint,
        evidenceSha256: validationArtifact.sha256,
        status: validation.status
      },
      files,
      proposedGitHubActions: [
        { order: 1, action: "CREATE_SCOPED_BRANCH", branch },
        { order: 2, action: "COMMIT_EXACT_FILES", files: files.map(file => file.path) },
        { order: 3, action: "PUSH_SCOPED_BRANCH", remote: "origin" },
        { order: 4, action: "OPEN_DRAFT_PULL_REQUEST", base: "main", title }
      ],
      authorization: {
        sourceWritesAuthorized: false,
        gitCommitAuthorized: false,
        gitPushAuthorized: false,
        draftPullRequestAuthorized: false,
        mergeAuthorized: false,
        deploymentAuthorized: false,
        requiredApprovals: [
          "GIT_COMMIT_AND_PUSH",
          "PULL_REQUEST",
          "MERGE",
          "PRODUCTION_DEPLOYMENT"
        ]
      },
      integrity: {
        planArtifactSha256: planArtifact.sha256,
        modificationArtifactSha256: manifestArtifact.sha256,
        validationArtifactSha256: validationArtifact.sha256
      }
    };
  }

  atomicWrite(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, content, "utf8");
    try {
      fs.renameSync(temporary, filePath);
    } catch {
      fs.copyFileSync(temporary, filePath);
      try { fs.unlinkSync(temporary); } catch {}
    }
  }

  persistWorkflow(workflow) {
    if (
      workflow?.ok !== true ||
      !/^GITHUB-WORKFLOW-[A-F0-9]{16}$/.test(workflow.workflowId || "") ||
      workflow.authorization?.mergeAuthorized !== false
    ) {
      throw new Error("GITHUB_WORKFLOW_FAILED_VALIDATION");
    }
    const filePath = path.join(this.outputRoot, `${workflow.workflowId}.json`);
    this.atomicWrite(filePath, JSON.stringify(workflow, null, 2));
    return {
      ok: true,
      filePath,
      bytes: fs.statSync(filePath).size,
      sha256: sha256(fs.readFileSync(filePath)),
      workflowId: workflow.workflowId,
      workflowFingerprint: workflow.workflowFingerprint
    };
  }
}

module.exports = GovernedGitHubWorkflowService;
module.exports.GovernedGitHubWorkflowService = GovernedGitHubWorkflowService;
module.exports.sha256 = sha256;
module.exports.slugify = slugify;

