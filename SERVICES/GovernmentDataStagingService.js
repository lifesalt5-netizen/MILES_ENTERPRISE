"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.env.MILES_ROOT || process.cwd();
const DEFAULT_POLICY_PATH = path.join(
  DEFAULT_ROOT,
  "CONFIG",
  "GOVERNMENT_DATA",
  "source_refresh_policy.json"
);

function isoFileStamp(value = new Date()) {
  return value
    .toISOString()
    .replace(/[:.]/g, "-");
}

function safeSourceId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  if (!normalized) {
    throw new Error("A source ID is required.");
  }

  return normalized;
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const file = fs.readFileSync(filePath);
  hash.update(file);
  return hash.digest("hex").toUpperCase();
}

class GovernmentDataStagingService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || DEFAULT_ROOT);
    this.policyPath = path.resolve(
      options.policyPath || DEFAULT_POLICY_PATH
    );
    this.policy =
      options.policy ||
      JSON.parse(fs.readFileSync(this.policyPath, "utf8"));

    const configuredStaging =
      options.stagingRoot ||
      process.env.GOVERNMENT_DATA_STAGING_ROOT ||
      this.policy.defaultStagingPath;

    this.stagingRoot = path.resolve(
      path.isAbsolute(configuredStaging)
        ? configuredStaging
        : path.join(this.root, configuredStaging)
    );

    this.currentRun = null;
  }

  assertStagingPath(targetPath) {
    const resolved = path.resolve(targetPath);
    const relative = path.relative(this.stagingRoot, resolved);

    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Operational write blocked outside government-data staging: ${resolved}`
      );
    }

    return resolved;
  }

  listSources() {
    return Object.entries(this.policy.sources || {}).map(
      ([id, source]) => ({
        id,
        enabled: source.enabled === true,
        phase: source.phase,
        status:
          source.enabled === true
            ? "READY"
            : source.status || "DISABLED",
        authority: source.authority,
        documentation: source.documentation,
        requiresEnvironmentVariable:
          source.requiresEnvironmentVariable || null
      })
    );
  }

  resolveSources(sourceIds = null) {
    const available = this.policy.sources || {};
    const selected =
      Array.isArray(sourceIds) && sourceIds.length > 0
        ? sourceIds
        : Object.entries(available)
            .filter(([, source]) => source.enabled === true)
            .map(([id]) => id);

    return selected.map(id => {
      if (!available[id]) {
        throw new Error(`Unknown government-data source: ${id}`);
      }

      if (available[id].enabled !== true) {
        throw new Error(
          `Government-data source is not enabled: ${id}`
        );
      }

      return {
        id,
        ...available[id]
      };
    });
  }

  plan(sourceIds = null) {
    const sources = this.resolveSources(sourceIds);

    return {
      ok: true,
      mode: "PLAN_ONLY",
      policyId: this.policy.policyId,
      policyVersion: this.policy.version,
      stagingRoot: this.stagingRoot,
      sources: sources.map(source => ({
        id: source.id,
        authority: source.authority,
        endpoint: source.endpoint,
        method: source.method,
        responseType: source.responseType,
        requiresEnvironmentVariable:
          source.requiresEnvironmentVariable || null
      })),
      safety: this.safetyState()
    };
  }

  safetyState() {
    return {
      mode: "STAGING_ONLY",
      operationalWritesAllowed: false,
      orionDatabaseWrites: false,
      outboundInventoryWrites: false,
      taskQueueWrites: false,
      instantlyWrites: false,
      campaignWrites: false,
      blockedDestinations:
        this.policy.blockedDestinations || []
    };
  }

  beginRun(sourceIds = null, now = new Date()) {
    const sources = this.resolveSources(sourceIds);
    const runId = `GOVDATA-${isoFileStamp(now)}`;
    const runDir = this.assertStagingPath(
      path.join(this.stagingRoot, runId)
    );

    fs.mkdirSync(runDir, { recursive: true });

    this.currentRun = {
      manifestVersion: 1,
      runId,
      policyId: this.policy.policyId,
      policyVersion: this.policy.version,
      mode: "STAGING_ONLY",
      status: "RUNNING",
      startedAt: now.toISOString(),
      completedAt: null,
      runDir,
      requestedSources: sources.map(source => source.id),
      artifacts: [],
      failures: [],
      safety: this.safetyState()
    };

    this.persistManifest();
    return this.currentRun;
  }

  artifactPath(sourceId, extension = ".bin") {
    if (!this.currentRun) {
      throw new Error("No government-data staging run is active.");
    }

    const safeId = safeSourceId(sourceId);
    const safeExtension = /^\.[a-zA-Z0-9]+$/.test(extension)
      ? extension
      : ".bin";

    return this.assertStagingPath(
      path.join(
        this.currentRun.runDir,
        `${safeId}${safeExtension}`
      )
    );
  }

  recordArtifact(source, filePath, metadata = {}) {
    if (!this.currentRun) {
      throw new Error("No government-data staging run is active.");
    }

    const resolved = this.assertStagingPath(filePath);
    const stat = fs.statSync(resolved);

    const artifact = {
      sourceId: source.id,
      authority: source.authority,
      documentation: source.documentation,
      endpoint: source.endpoint,
      filePath: resolved,
      bytes: stat.size,
      sha256: sha256(resolved),
      contentType: metadata.contentType || null,
      retrievedAt:
        metadata.retrievedAt || new Date().toISOString(),
      sourceDate: metadata.sourceDate || null
    };

    this.currentRun.artifacts.push(artifact);
    this.persistManifest();
    return artifact;
  }

  recordFailure(source, error) {
    if (!this.currentRun) {
      throw new Error("No government-data staging run is active.");
    }

    const failure = {
      sourceId: source.id,
      authority: source.authority,
      endpoint: source.endpoint,
      message: String(error?.message || error),
      failedAt: new Date().toISOString()
    };

    this.currentRun.failures.push(failure);
    this.persistManifest();
    return failure;
  }

  complete(now = new Date()) {
    if (!this.currentRun) {
      throw new Error("No government-data staging run is active.");
    }

    this.currentRun.status =
      this.currentRun.failures.length > 0
        ? "COMPLETED_WITH_ERRORS"
        : "COMPLETED";
    this.currentRun.completedAt = now.toISOString();
    this.persistManifest();

    return {
      ...this.currentRun,
      manifestPath: this.manifestPath()
    };
  }

  manifestPath() {
    if (!this.currentRun) {
      throw new Error("No government-data staging run is active.");
    }

    return this.assertStagingPath(
      path.join(this.currentRun.runDir, "manifest.json")
    );
  }

  persistManifest() {
    const manifestPath = this.manifestPath();
    const temporaryPath = `${manifestPath}.tmp`;
    const text = `${JSON.stringify(this.currentRun, null, 2)}\n`;

    fs.writeFileSync(temporaryPath, text, "utf8");
    fs.renameSync(temporaryPath, manifestPath);
    return manifestPath;
  }
}

module.exports = GovernmentDataStagingService;
