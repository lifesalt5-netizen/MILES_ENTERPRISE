"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".env",
  "node_modules",
  "data",
  "recovery",
  "logs",
  "state",
  "credentials",
  "secrets"
]);

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

function canonicalApproval(value) {
  return {
    authorization: "SOURCE_MODIFICATION",
    planId: value.planId,
    planFingerprint: value.planFingerprint,
    repositoryFingerprint: value.repositoryFingerprint,
    changeSetSha256: value.changeSetSha256,
    approvedFiles: [...value.approvedFiles].sort(),
    approvedBy: value.approvedBy,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt
  };
}

function signApproval(value, key) {
  return crypto
    .createHmac("sha256", key)
    .update(JSON.stringify(canonicalApproval(value)))
    .digest("hex")
    .toUpperCase();
}

class GovernedCodeModificationService {
  constructor(options = {}) {
    this.service = "GOVERNED_CODE_MODIFICATION";
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..")
    );
    this.graphPath =
      options.graphPath ||
      path.join(
        this.rootDir,
        "DATA",
        "runtime",
        "engineering",
        "repository_dependency_graph.json"
      );
    this.evidenceRoot =
      options.evidenceRoot ||
      path.join(
        this.rootDir,
        "DATA",
        "runtime",
        "engineering"
      );
    this.approvalRoot =
      options.approvalRoot ||
      path.join(
        this.evidenceRoot,
        "approvals"
      );
    this.approvalKey =
      options.approvalKey ||
      process.env.MILES_ENGINEERING_APPROVAL_KEY ||
      "";
    this.maxContentBytes = Number(
      options.maxContentBytes || 2 * 1024 * 1024
    );
    this.now =
      options.now ||
      (() => Date.now());
    this.writeImpl =
      options.writeImpl ||
      ((filePath, content) =>
        this.atomicWrite(filePath, content));
  }

  readJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`${label}_MISSING`);
    }
    try {
      return JSON.parse(
        fs.readFileSync(filePath, "utf8")
      );
    } catch (error) {
      throw new Error(
        `${label}_INVALID: ${error.message}`
      );
    }
  }

  validateRelativePath(relativePath) {
    const normalized = normalizeRelative(relativePath);
    const segments = normalized.split("/");

    if (
      !normalized ||
      path.isAbsolute(relativePath) ||
      segments.includes("..") ||
      segments.includes(".") ||
      segments.some(segment =>
        BLOCKED_SEGMENTS.has(
          segment.toLowerCase()
        )
      )
    ) {
      throw new Error(
        `SOURCE_PATH_NOT_ALLOWED: ${relativePath}`
      );
    }

    const fullPath = path.resolve(
      this.rootDir,
      ...segments
    );
    const rootPrefix =
      this.rootDir.endsWith(path.sep)
        ? this.rootDir
        : `${this.rootDir}${path.sep}`;

    if (
      fullPath !== this.rootDir &&
      !fullPath.startsWith(rootPrefix)
    ) {
      throw new Error(
        `SOURCE_PATH_OUTSIDE_ROOT: ${relativePath}`
      );
    }

    return {
      relativePath: normalized,
      fullPath
    };
  }

  normalizeChangeSet(changeSet) {
    if (
      !changeSet ||
      !changeSet.planId ||
      !changeSet.repositoryFingerprint ||
      !Array.isArray(changeSet.changes) ||
      changeSet.changes.length === 0
    ) {
      throw new Error(
        "CHANGE_SET_FAILED_VALIDATION"
      );
    }

    const seen = new Set();
    const changes = changeSet.changes.map(change => {
      const target = this.validateRelativePath(change.path);
      if (seen.has(target.relativePath)) {
        throw new Error(
          `DUPLICATE_SOURCE_CHANGE: ${target.relativePath}`
        );
      }
      seen.add(target.relativePath);

      if (change.operation !== "REPLACE") {
        throw new Error(
          `SOURCE_OPERATION_NOT_ALLOWED: ${change.operation}`
        );
      }
      if (
        typeof change.content !== "string" ||
        Buffer.byteLength(change.content, "utf8") >
          this.maxContentBytes
      ) {
        throw new Error(
          `SOURCE_CONTENT_INVALID: ${target.relativePath}`
        );
      }
      if (!/^[A-F0-9]{64}$/.test(change.beforeSha256 || "")) {
        throw new Error(
          `SOURCE_BEFORE_HASH_INVALID: ${target.relativePath}`
        );
      }

      return {
        path: target.relativePath,
        operation: "REPLACE",
        beforeSha256: change.beforeSha256,
        afterSha256: sha256(
          Buffer.from(change.content, "utf8")
        ),
        content: change.content
      };
    });

    const normalized = {
      planId: changeSet.planId,
      repositoryFingerprint:
        changeSet.repositoryFingerprint,
      changes: changes.sort((first, second) =>
        first.path.localeCompare(second.path)
      )
    };

    return {
      ...normalized,
      changeSetSha256: sha256(
        Buffer.from(JSON.stringify(normalized), "utf8")
      )
    };
  }

  validatePlan(plan, graph, changeSet) {
    if (
      !plan ||
      plan.ok !== true ||
      !plan.planId ||
      !plan.planFingerprint ||
      !Array.isArray(plan.scope?.targets)
    ) {
      throw new Error(
        "ENGINEERING_PLAN_FAILED_VALIDATION"
      );
    }

    if (
      !graph ||
      graph.ok !== true ||
      graph.validation?.ok !== true ||
      graph.fingerprint !==
        plan.repository?.fingerprint ||
      graph.fingerprint !==
        changeSet.repositoryFingerprint
    ) {
      throw new Error(
        "REPOSITORY_FINGERPRINT_MISMATCH"
      );
    }

    if (changeSet.planId !== plan.planId) {
      throw new Error(
        "CHANGE_SET_PLAN_MISMATCH"
      );
    }

    const targets = new Set(
      plan.scope.targets.map(target =>
        normalizeRelative(target.id)
      )
    );

    for (const change of changeSet.changes) {
      if (!targets.has(change.path)) {
        throw new Error(
          `SOURCE_NOT_IN_APPROVED_PLAN_SCOPE: ${change.path}`
        );
      }
    }
  }

  validateCurrentFiles(changeSet) {
    return changeSet.changes.map(change => {
      const target = this.validateRelativePath(change.path);
      if (!fs.existsSync(target.fullPath)) {
        throw new Error(
          `SOURCE_FILE_MISSING: ${change.path}`
        );
      }

      const stat = fs.lstatSync(target.fullPath);
      const realRoot = fs.realpathSync(this.rootDir);
      const realTarget = fs.realpathSync(target.fullPath);
      const realRootPrefix =
        realRoot.endsWith(path.sep)
          ? realRoot
          : `${realRoot}${path.sep}`;

      if (
        realTarget !== realRoot &&
        !realTarget.startsWith(realRootPrefix)
      ) {
        throw new Error(
          `SOURCE_REAL_PATH_OUTSIDE_ROOT: ${change.path}`
        );
      }

      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(
          `SOURCE_FILE_TYPE_NOT_ALLOWED: ${change.path}`
        );
      }

      const current = fs.readFileSync(target.fullPath);
      const currentSha256 = sha256(current);

      if (currentSha256 !== change.beforeSha256) {
        throw new Error(
          `SOURCE_CHANGED_SINCE_PLAN: ${change.path}`
        );
      }

      if (currentSha256 === change.afterSha256) {
        throw new Error(
          `SOURCE_CHANGE_HAS_NO_EFFECT: ${change.path}`
        );
      }

      return {
        ...change,
        fullPath: target.fullPath,
        currentSha256,
        bytesBefore: current.length,
        bytesAfter:
          Buffer.byteLength(change.content, "utf8")
      };
    });
  }

  createApproval(input) {
    if (
      typeof this.approvalKey !== "string" ||
      this.approvalKey.length < 32
    ) {
      throw new Error(
        "ENGINEERING_APPROVAL_KEY_UNAVAILABLE"
      );
    }

    const issuedAtMs = this.now();
    const expiresInMs = Number(
      input.expiresInMs || 15 * 60 * 1000
    );
    const approval = canonicalApproval({
      planId: input.planId,
      planFingerprint: input.planFingerprint,
      repositoryFingerprint:
        input.repositoryFingerprint,
      changeSetSha256: input.changeSetSha256,
      approvedFiles: input.approvedFiles,
      approvedBy: input.approvedBy || "CEO",
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt:
        new Date(issuedAtMs + expiresInMs).toISOString()
    });

    return {
      ...approval,
      signature: signApproval(
        approval,
        this.approvalKey
      )
    };
  }

  approvalFilePath(approval) {
    const fileName =
      `${approval.planId}-${approval.changeSetSha256.slice(0, 16)}.json`;
    return path.join(
      this.approvalRoot,
      fileName
    );
  }

  validateApproval(approval, plan, changeSet) {
    if (
      typeof this.approvalKey !== "string" ||
      this.approvalKey.length < 32
    ) {
      throw new Error(
        "ENGINEERING_APPROVAL_KEY_UNAVAILABLE"
      );
    }
    if (
      !approval ||
      approval.authorization !==
        "SOURCE_MODIFICATION" ||
      !Array.isArray(approval.approvedFiles) ||
      !/^[A-F0-9]{64}$/.test(approval.signature || "")
    ) {
      throw new Error(
        "SOURCE_MODIFICATION_APPROVAL_INVALID"
      );
    }

    const expected = signApproval(
      approval,
      this.approvalKey
    );
    const supplied = Buffer.from(
      approval.signature,
      "hex"
    );
    const expectedBuffer = Buffer.from(
      expected,
      "hex"
    );

    if (
      supplied.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(
        supplied,
        expectedBuffer
      )
    ) {
      throw new Error(
        "SOURCE_MODIFICATION_APPROVAL_SIGNATURE_INVALID"
      );
    }

    const issuedAt = Date.parse(approval.issuedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    const now = this.now();
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      issuedAt > now + 5 * 60 * 1000 ||
      expiresAt <= now
    ) {
      throw new Error(
        "SOURCE_MODIFICATION_APPROVAL_EXPIRED"
      );
    }

    const approvedFiles = [
      ...approval.approvedFiles
    ].map(normalizeRelative).sort();
    const changedFiles = changeSet.changes
      .map(change => change.path)
      .sort();

    if (
      approval.planId !== plan.planId ||
      approval.planFingerprint !==
        plan.planFingerprint ||
      approval.repositoryFingerprint !==
        changeSet.repositoryFingerprint ||
      approval.changeSetSha256 !==
        changeSet.changeSetSha256 ||
      approvedFiles.join("|") !==
        changedFiles.join("|")
    ) {
      throw new Error(
        "SOURCE_MODIFICATION_APPROVAL_SCOPE_MISMATCH"
      );
    }

    return {
      ok: true,
      approvedBy: approval.approvedBy,
      issuedAt: approval.issuedAt,
      expiresAt: approval.expiresAt
    };
  }

  preflight(input) {
    const plan = this.readJson(
      input.planPath,
      "ENGINEERING_PLAN"
    );
    const graph = this.readJson(
      this.graphPath,
      "REPOSITORY_GRAPH"
    );
    const rawChangeSet = this.readJson(
      input.changeSetPath,
      "CHANGE_SET"
    );
    const approval = this.readJson(
      input.approvalPath,
      "SOURCE_MODIFICATION_APPROVAL"
    );
    const changeSet =
      this.normalizeChangeSet(rawChangeSet);

    this.validatePlan(
      plan,
      graph,
      changeSet
    );
    const files =
      this.validateCurrentFiles(changeSet);
    const authorization =
      this.validateApproval(
        approval,
        plan,
        changeSet
      );

    const executionId =
      `CODE-MOD-${changeSet.changeSetSha256.slice(0, 16)}`;

    return {
      ok: true,
      service: this.service,
      mode: "PREFLIGHT",
      executionId,
      plan: {
        planId: plan.planId,
        planFingerprint:
          plan.planFingerprint
      },
      repositoryFingerprint:
        changeSet.repositoryFingerprint,
      changeSetSha256:
        changeSet.changeSetSha256,
      authorization,
      files
    };
  }

  atomicWrite(filePath, content) {
    const temporary =
      `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
      temporary,
      content,
      "utf8"
    );
    try {
      fs.renameSync(temporary, filePath);
    } catch {
      fs.copyFileSync(temporary, filePath);
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
  }

  apply(input) {
    const preflight = this.preflight(input);
    if (input.apply !== true) {
      return {
        ...preflight,
        mode: "PREVIEW_ONLY",
        sourceWritesPerformed: false
      };
    }

    const backupRoot = path.join(
      this.evidenceRoot,
      "backups",
      preflight.executionId
    );
    const manifestPath = path.join(
      this.evidenceRoot,
      "modifications",
      `${preflight.executionId}.json`
    );
    const applied = [];

    fs.mkdirSync(backupRoot, {
      recursive: true
    });

    try {
      for (const file of preflight.files) {
        const backupPath = path.join(
          backupRoot,
          ...file.path.split("/")
        );
        fs.mkdirSync(
          path.dirname(backupPath),
          { recursive: true }
        );
        fs.copyFileSync(
          file.fullPath,
          backupPath
        );

        const appliedRecord = {
          ...file,
          backupPath,
          afterSha256: null
        };
        applied.push(appliedRecord);

        this.writeImpl(
          file.fullPath,
          file.content
        );

        const afterSha256 = sha256(
          fs.readFileSync(file.fullPath)
        );
        if (afterSha256 !== file.afterSha256) {
          throw new Error(
            `SOURCE_WRITE_VERIFICATION_FAILED: ${file.path}`
          );
        }

        appliedRecord.afterSha256 =
          afterSha256;
      }
    } catch (error) {
      for (const file of applied.reverse()) {
        try {
          fs.copyFileSync(
            file.backupPath,
            file.fullPath
          );
        } catch {}
      }
      throw new Error(
        `SOURCE_MODIFICATION_ROLLED_BACK: ${error.message}`
      );
    }

    const manifest = {
      ok: true,
      service: this.service,
      status: "APPLIED",
      executionId: preflight.executionId,
      plan: preflight.plan,
      repositoryFingerprint:
        preflight.repositoryFingerprint,
      changeSetSha256:
        preflight.changeSetSha256,
      approvedBy:
        preflight.authorization.approvedBy,
      appliedAt:
        new Date(this.now()).toISOString(),
      sourceWritesPerformed: true,
      gitWritesPerformed: false,
      pullRequestCreated: false,
      mergePerformed: false,
      deploymentPerformed: false,
      files: applied.map(file => ({
        path: file.path,
        beforeSha256: file.beforeSha256,
        afterSha256: file.afterSha256,
        backupPath: file.backupPath,
        bytesBefore: file.bytesBefore,
        bytesAfter: file.bytesAfter
      }))
    };

    fs.mkdirSync(
      path.dirname(manifestPath),
      { recursive: true }
    );
    this.atomicWrite(
      manifestPath,
      JSON.stringify(manifest, null, 2)
    );

    return {
      ...manifest,
      mode: "APPLY",
      manifestPath,
      manifestSha256:
        sha256(fs.readFileSync(manifestPath))
    };
  }
}

module.exports = GovernedCodeModificationService;
module.exports.GovernedCodeModificationService =
  GovernedCodeModificationService;
module.exports.sha256 = sha256;
module.exports.signApproval = signApproval;
module.exports.canonicalApproval = canonicalApproval;
