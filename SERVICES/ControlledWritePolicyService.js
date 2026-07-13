"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "controlled_write");
const POLICY_FILE = path.join(OUT_DIR, "controlled_write_policy.json");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) {
  try { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

const DEFAULT_POLICY = {
  version: "EXEC_004.1",
  mode: "CONTROLLED_WRITE",
  generatedAt: null,
  global: {
    dryRunDefault: true,
    writesRequireExplicitEnv: true,
    writeEnvVar: "MILES_CONTROLLED_WRITE_ENABLED",
    instantWriteEnvVar: "INSTANTLY_WRITE_ENABLED",
    productionSafeguard: true,
    requireTestPrefix: true,
    testPrefix: "MILES_TEST_",
    maxRetries: 1,
    requireVerification: true,
    allowDestructive: false
  },
  providers: {
    instantly: {
      enabled: true,
      writeEnabled: false,
      allowedWriteOperations: [
        "CREATE_TEST_CAMPAIGN",
        "PAUSE_TEST_CAMPAIGN",
        "RESUME_TEST_CAMPAIGN"
      ],
      blockedOperations: [
        "DELETE_CAMPAIGN",
        "BULK_UPLOAD_LEADS_PRODUCTION",
        "START_PRODUCTION_CAMPAIGN"
      ],
      readOperations: [
        "HEALTH_CHECK",
        "LIST_CAMPAIGNS",
        "GET_CAMPAIGN",
        "GENERATE_CAMPAIGN_REPORT"
      ]
    }
  }
};

class ControlledWritePolicyService {
  load() {
    ensureDir(OUT_DIR);
    const existing = readJson(POLICY_FILE, null);
    if (existing) return existing;
    const policy = { ...DEFAULT_POLICY, generatedAt: new Date().toISOString() };
    writeJson(POLICY_FILE, policy);
    return policy;
  }

  save(policy) {
    policy.generatedAt = policy.generatedAt || new Date().toISOString();
    policy.updatedAt = new Date().toISOString();
    writeJson(POLICY_FILE, policy);
    return policy;
  }

  evaluate(action = {}) {
    const policy = this.load();
    const provider = String(action.provider || "").toLowerCase();
    const operation = String(action.operation || "").toUpperCase();
    const providerPolicy = policy.providers[provider];
    const writeRequested = action.write === true || action.mode === "WRITE" || /CREATE|UPDATE|PAUSE|RESUME|UPLOAD|ASSIGN|PUBLISH|DELETE|SUSPEND/.test(operation);
    const globalWriteEnabled = String(process.env[policy.global.writeEnvVar] || "").toLowerCase() === "true";
    const instantlyWriteEnabled = String(process.env[policy.global.instantWriteEnvVar] || "").toLowerCase() === "true";
    const writeEnabled = globalWriteEnabled && (provider !== "instantly" || instantlyWriteEnabled);

    if (!providerPolicy) {
      return { ok: false, allowed: false, status: "UNKNOWN_PROVIDER", reason: `No controlled-write policy for provider ${provider}.`, policy };
    }

    if (providerPolicy.blockedOperations.includes(operation)) {
      return { ok: true, allowed: false, status: "BLOCKED_OPERATION", reason: `${operation} is blocked by controlled-write policy.`, policy };
    }

    if (!writeRequested) {
      return { ok: true, allowed: true, dryRun: false, status: "READ_ALLOWED", reason: "Read operation allowed.", policy };
    }

    const allowed = providerPolicy.allowedWriteOperations.includes(operation);
    if (!allowed) {
      return { ok: true, allowed: false, dryRun: true, status: "WRITE_NOT_ALLOWLISTED", reason: `${operation} is not allowlisted for controlled writes.`, policy };
    }

    const name = action.payload?.name || action.payload?.title || "";
    if (policy.global.requireTestPrefix && name && !String(name).startsWith(policy.global.testPrefix)) {
      return { ok: true, allowed: false, dryRun: true, status: "TEST_PREFIX_REQUIRED", reason: `Write name must start with ${policy.global.testPrefix}.`, policy };
    }

    if (!writeEnabled) {
      return { ok: true, allowed: false, dryRun: true, status: "SAFE_MODE_WRITE_DISABLED", reason: `Set ${policy.global.writeEnvVar}=true and provider write flag to allow controlled writes.`, policy };
    }

    return { ok: true, allowed: true, dryRun: false, status: "CONTROLLED_WRITE_ALLOWED", reason: "Write operation is allowlisted and write mode is explicitly enabled.", policy };
  }

  run(input = {}) {
    const policy = this.load();
    return {
      ok: true,
      action: "CONTROLLED_WRITE_POLICY",
      generatedAt: new Date().toISOString(),
      outDir: OUT_DIR,
      policy
    };
  }
}

module.exports = new ControlledWritePolicyService();
