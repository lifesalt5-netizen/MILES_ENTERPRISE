"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

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

class GovernedEngineeringValidationService {
  constructor(options = {}) {
    this.service = "GOVERNED_ENGINEERING_VALIDATION";
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..")
    );
    this.graphPath = options.graphPath || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "engineering",
      "repository_dependency_graph.json"
    );
    this.evidenceRoot = options.evidenceRoot || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "engineering",
      "validation"
    );
    this.commandTimeoutMs = Number(
      options.commandTimeoutMs || 10 * 60 * 1000
    );
    this.maxCommands = Number(options.maxCommands || 50);
    this.maxOutputBytes = Number(
      options.maxOutputBytes || 1024 * 1024
    );
    this.now = options.now || (() => Date.now());
    this.spawnImpl = options.spawnImpl || childProcess.spawnSync;
  }

  readJson(filePath, label) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`${label}_MISSING`);
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`${label}_INVALID: ${error.message}`);
    }
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
      throw new Error(`VALIDATION_PATH_NOT_ALLOWED: ${relativePath}`);
    }
    const fullPath = path.resolve(this.rootDir, ...segments);
    const prefix = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : `${this.rootDir}${path.sep}`;
    if (!fullPath.startsWith(prefix)) {
      throw new Error(`VALIDATION_PATH_OUTSIDE_ROOT: ${relativePath}`);
    }
    return { relativePath: normalized, fullPath };
  }

  parseCommand(command) {
    const value = String(command || "").trim();
    if (!value || /[;&|><`$()\r\n]/.test(value)) {
      throw new Error(`VALIDATION_COMMAND_NOT_ALLOWED: ${value}`);
    }

    let match = value.match(/^node --check "([^"]+)"$/);
    if (match) {
      const target = this.resolveSource(match[1]);
      return {
        command: value,
        executable: process.execPath,
        args: ["--check", target.fullPath],
        target: target.relativePath,
        kind: "SYNTAX"
      };
    }

    match = value.match(/^node "([^"]+)"$/);
    if (match) {
      const target = this.resolveSource(match[1]);
      return {
        command: value,
        executable: process.execPath,
        args: [target.fullPath],
        target: target.relativePath,
        kind: "TEST"
      };
    }

    if (value === "npm test") {
      return {
        command: value,
        executable: process.platform === "win32" ? "npm.cmd" : "npm",
        args: ["test"],
        target: "package.json",
        kind: "TEST_SUITE"
      };
    }

    throw new Error(`VALIDATION_COMMAND_NOT_ALLOWED: ${value}`);
  }

  validatePlan(plan, graph) {
    const commands = plan?.validation?.commands;
    if (
      plan?.ok !== true ||
      !/^ENGINEERING-PLAN-[A-F0-9]{16}$/.test(plan.planId || "") ||
      !/^[A-F0-9]{64}$/.test(plan.planFingerprint || "") ||
      !Array.isArray(commands) ||
      commands.length === 0 ||
      commands.length > this.maxCommands
    ) {
      throw new Error("ENGINEERING_VALIDATION_PLAN_INVALID");
    }
    if (
      graph?.ok !== true ||
      graph?.validation?.ok !== true ||
      graph.fingerprint !== plan.repository?.fingerprint
    ) {
      throw new Error("VALIDATION_REPOSITORY_FINGERPRINT_MISMATCH");
    }

    const unique = new Set();
    const parsed = commands.map(command => {
      if (unique.has(command)) {
        throw new Error(`DUPLICATE_VALIDATION_COMMAND: ${command}`);
      }
      unique.add(command);
      return this.parseCommand(command);
    });

    for (const command of parsed) {
      if (
        command.kind !== "TEST_SUITE" &&
        !fs.existsSync(command.args[command.args.length - 1])
      ) {
        throw new Error(`VALIDATION_TARGET_MISSING: ${command.target}`);
      }
    }
    return parsed;
  }

  validateManifest(manifest, plan, graph) {
    if (
      manifest?.ok !== true ||
      manifest.service !== "GOVERNED_CODE_MODIFICATION" ||
      manifest.status !== "APPLIED" ||
      manifest.sourceWritesPerformed !== true ||
      !Array.isArray(manifest.files) ||
      manifest.files.length === 0 ||
      manifest.plan?.planId !== plan.planId ||
      manifest.plan?.planFingerprint !== plan.planFingerprint ||
      manifest.repositoryFingerprint !== graph.fingerprint
    ) {
      throw new Error("CODE_MODIFICATION_MANIFEST_INVALID");
    }
    if (
      manifest.gitWritesPerformed !== false ||
      manifest.mergePerformed !== false ||
      manifest.deploymentPerformed !== false
    ) {
      throw new Error("MODIFICATION_AUTHORITY_BOUNDARY_VIOLATED");
    }
  }

  verifyModifiedFiles(manifest) {
    return manifest.files.map(file => {
      const target = this.resolveSource(file.path);
      if (
        !/^[A-F0-9]{64}$/.test(file.afterSha256 || "") ||
        !fs.existsSync(target.fullPath) ||
        !fs.lstatSync(target.fullPath).isFile() ||
        fs.lstatSync(target.fullPath).isSymbolicLink()
      ) {
        throw new Error(`VALIDATED_SOURCE_FILE_INVALID: ${file.path}`);
      }
      const actualSha256 = sha256(fs.readFileSync(target.fullPath));
      if (actualSha256 !== file.afterSha256) {
        throw new Error(`VALIDATED_SOURCE_HASH_MISMATCH: ${file.path}`);
      }
      return {
        path: target.relativePath,
        expectedSha256: file.afterSha256,
        actualSha256,
        bytes: fs.statSync(target.fullPath).size
      };
    });
  }

  preflight(input) {
    const plan = this.readJson(input.planPath, "ENGINEERING_PLAN");
    const graph = this.readJson(this.graphPath, "REPOSITORY_GRAPH");
    const manifest = this.readJson(
      input.manifestPath,
      "CODE_MODIFICATION_MANIFEST"
    );
    const commands = this.validatePlan(plan, graph);
    this.validateManifest(manifest, plan, graph);
    const files = this.verifyModifiedFiles(manifest);
    const identity = {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      repositoryFingerprint: graph.fingerprint,
      modificationExecutionId: manifest.executionId,
      commands: commands.map(item => item.command),
      files: files.map(file => ({
        path: file.path,
        sha256: file.actualSha256
      }))
    };
    const validationFingerprint = sha256(
      Buffer.from(JSON.stringify(identity), "utf8")
    );
    return {
      ok: true,
      service: this.service,
      mode: "PREFLIGHT",
      validationId: `ENGINEERING-VALIDATION-${validationFingerprint.slice(0, 16)}`,
      validationFingerprint,
      plan: {
        planId: plan.planId,
        planFingerprint: plan.planFingerprint
      },
      repositoryFingerprint: graph.fingerprint,
      modificationExecutionId: manifest.executionId,
      commands,
      files
    };
  }

  truncate(value) {
    const buffer = Buffer.from(String(value || ""), "utf8");
    if (buffer.length <= this.maxOutputBytes) {
      return buffer.toString("utf8");
    }
    return buffer.subarray(0, this.maxOutputBytes).toString("utf8");
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

  run(input) {
    const preflight = this.preflight(input);
    if (input.apply !== true) {
      return {
        ...preflight,
        mode: "PLAN_ONLY",
        commandsExecuted: 0,
        evidenceWritten: false
      };
    }

    const startedAtMs = this.now();
    const results = [];
    for (const command of preflight.commands) {
      const commandStartedAt = this.now();
      const execution = this.spawnImpl(
        command.executable,
        command.args,
        {
          cwd: this.rootDir,
          shell: false,
          encoding: "utf8",
          timeout: this.commandTimeoutMs,
          windowsHide: true,
          maxBuffer: this.maxOutputBytes
        }
      ) || {};
      const exitCode = Number.isInteger(execution.status)
        ? execution.status
        : 1;
      const result = {
        command: command.command,
        kind: command.kind,
        target: command.target,
        exitCode,
        signal: execution.signal || null,
        timedOut: execution.error?.code === "ETIMEDOUT",
        stdout: this.truncate(execution.stdout),
        stderr: this.truncate(
          execution.stderr || execution.error?.message
        ),
        durationMs: Math.max(0, this.now() - commandStartedAt),
        passed: exitCode === 0 && !execution.error
      };
      results.push(result);
      if (!result.passed) break;
    }

    let postValidationFiles = [];
    let postValidationError = null;
    try {
      const manifest = this.readJson(
        input.manifestPath,
        "CODE_MODIFICATION_MANIFEST"
      );
      postValidationFiles = this.verifyModifiedFiles(manifest);
    } catch (error) {
      postValidationError = error.message;
    }

    const passed =
      results.length === preflight.commands.length &&
      results.every(result => result.passed) &&
      postValidationError === null;
    const completedAtMs = this.now();
    const evidence = {
      ok: passed,
      service: this.service,
      status: passed ? "PASSED" : "FAILED",
      mode: "APPLY",
      validationId: preflight.validationId,
      validationFingerprint: preflight.validationFingerprint,
      plan: preflight.plan,
      repositoryFingerprint: preflight.repositoryFingerprint,
      modificationExecutionId: preflight.modificationExecutionId,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      commandCount: preflight.commands.length,
      commandsExecuted: results.length,
      commandsPassed: results.filter(result => result.passed).length,
      results,
      preValidationFiles: preflight.files,
      postValidationFiles,
      postValidationError,
      sourceWritesPerformed: false,
      gitWritesPerformed: false,
      pullRequestCreated: false,
      mergePerformed: false,
      deploymentPerformed: false
    };
    const evidencePath = path.join(
      this.evidenceRoot,
      `${preflight.validationId}.json`
    );
    this.atomicWrite(evidencePath, JSON.stringify(evidence, null, 2));
    return {
      ...evidence,
      evidenceWritten: true,
      evidencePath,
      evidenceSha256: sha256(fs.readFileSync(evidencePath))
    };
  }
}

module.exports = GovernedEngineeringValidationService;
module.exports.GovernedEngineeringValidationService =
  GovernedEngineeringValidationService;
module.exports.sha256 = sha256;

