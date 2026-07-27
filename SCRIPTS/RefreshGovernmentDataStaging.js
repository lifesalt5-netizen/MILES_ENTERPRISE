"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const { pipeline } = require("stream/promises");
const axios = require("axios");

const ROOT = process.env.MILES_ROOT || process.cwd();

require("dotenv").config({
  path: path.join(ROOT, ".env"),
  quiet: true
});

const GovernmentDataStagingService =
  require("../SERVICES/GovernmentDataStagingService");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    sources: null,
    help: false
  };

  for (const value of argv) {
    if (value === "--apply") {
      args.apply = true;
    } else if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (value.startsWith("--sources=")) {
      args.sources = value
        .slice("--sources=".length)
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return args;
}

function helpText() {
  return [
    "Government data staging refresh",
    "",
    "Plan only (default):",
    "  node SCRIPTS/RefreshGovernmentDataStaging.js",
    "",
    "Download enabled sources to timestamped staging:",
    "  node SCRIPTS/RefreshGovernmentDataStaging.js --apply",
    "",
    "Select sources:",
    "  node SCRIPTS/RefreshGovernmentDataStaging.js --apply --sources=sam_public_entities,gsa_mas_catalog",
    "",
    "This script never writes to ORION, TaskQueue, DATA/OUTBOUND, Instantly, or campaigns."
  ].join("\n");
}

function ensureRequiredEnvironment(source) {
  const variable = source.requiresEnvironmentVariable;
  if (!variable) return null;

  const value = process.env[variable];
  if (!value || !String(value).trim()) {
    throw new Error(
      `Required environment variable is not configured: ${variable}`
    );
  }

  return String(value).trim();
}

function contentTypeAllowed(source, contentType) {
  const accepted = source.acceptedContentTypes || [];
  if (accepted.length === 0) return true;

  const normalized = String(contentType || "").toLowerCase();
  return accepted.some(type =>
    normalized.includes(String(type).toLowerCase())
  );
}

function downloadTimeoutMs() {
  const configured = Number(
    process.env.GOVERNMENT_DATA_DOWNLOAD_TIMEOUT_MS
  );

  if (Number.isFinite(configured) && configured >= 30000) {
    return configured;
  }

  return 1800000;
}

async function downloadSource(service, source) {
  const secret = ensureRequiredEnvironment(source);
  const destination = service.artifactPath(
    source.id,
    source.extension
  );
  const temporary = `${destination}.partial`;
  const parameters = {
    ...(source.parameters || {})
  };

  if (secret) {
    parameters.api_key = secret;
  }

  const headers = {
    "User-Agent": "MILES-Government-Data-Staging/1.0",
    Accept:
      source.responseType === "zip"
        ? "application/zip"
        : "text/html,application/xhtml+xml"
  };

  const response = await axios({
    method: source.method || "GET",
    url: source.endpoint,
    params: parameters,
    headers,
    responseType: "stream",
    timeout: downloadTimeoutMs(),
    maxRedirects: 5,
    httpsAgent: new https.Agent({
      family: 4,
      keepAlive: true
    }),
    validateStatus: status => status >= 200 && status < 300
  });

  const contentType = response.headers["content-type"] || "";
  if (!contentTypeAllowed(source, contentType)) {
    response.data.destroy();
    throw new Error(
      `Unexpected content type for ${source.id}: ${contentType || "missing"}`
    );
  }

  try {
    await pipeline(
      response.data,
      fs.createWriteStream(temporary, {
        flags: "wx"
      })
    );

    const bytes = fs.statSync(temporary).size;
    const minimumBytes = Number(source.minimumBytes || 1);
    if (bytes < minimumBytes) {
      throw new Error(
        `${source.id} returned ${bytes} bytes; minimum is ${minimumBytes}.`
      );
    }

    fs.renameSync(temporary, destination);

    return service.recordArtifact(
      source,
      destination,
      {
        contentType,
        retrievedAt: new Date().toISOString(),
        sourceDate:
          response.headers["last-modified"] || null
      }
    );
  } catch (error) {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
    throw error;
  }
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return {
      ok: true,
      mode: "HELP"
    };
  }

  const service = new GovernmentDataStagingService({
    root: ROOT
  });
  const plan = service.plan(args.sources);

  if (!args.apply) {
    console.log(JSON.stringify(plan, null, 2));
    console.log(
      "\nPLAN ONLY. Re-run with --apply to download raw source artifacts into staging."
    );
    return plan;
  }

  const sources = service.resolveSources(args.sources);
  service.beginRun(args.sources);

  for (const source of sources) {
    try {
      const artifact = await downloadSource(service, source);
      console.log(
        `[STAGED] ${source.id} bytes=${artifact.bytes} sha256=${artifact.sha256}`
      );
    } catch (error) {
      service.recordFailure(source, error);
      console.error(
        `[FAILED] ${source.id}: ${error.message}`
      );
    }
  }

  const result = service.complete();
  const output = {
    ok: result.failures.length === 0,
    mode: "STAGING_ONLY",
    runId: result.runId,
    status: result.status,
    manifestPath: result.manifestPath,
    artifacts: result.artifacts,
    failures: result.failures,
    safety: result.safety
  };

  console.log(JSON.stringify(output, null, 2));

  if (!output.ok) {
    process.exitCode = 2;
  }

  return output;
}

if (require.main === module) {
  run().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  contentTypeAllowed,
  downloadTimeoutMs,
  downloadSource,
  run
};
