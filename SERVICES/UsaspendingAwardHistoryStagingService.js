"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const DOWNLOAD_SEARCH =
  "https://api.usaspending.gov/api/v2/download/search/";
const CONTRACT_AND_IDV_CODES = [
  "A",
  "B",
  "C",
  "D",
  "IDV_A",
  "IDV_B",
  "IDV_B_A",
  "IDV_B_B",
  "IDV_B_C",
  "IDV_C",
  "IDV_D",
  "IDV_E"
];

function isoNow() {
  return new Date().toISOString();
}

function isoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        buffer.length,
        null
      );
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex").toUpperCase();
}

function statusName(payload) {
  return String(
    payload?.status ||
    payload?.state ||
    payload?.job_status ||
    ""
  ).trim().toLowerCase();
}

class UsaspendingAwardHistoryStagingService {
  constructor(options = {}) {
    this.root = path.resolve(
      options.root || process.env.MILES_ROOT || process.cwd()
    );
    this.stagingRoot = path.join(
      this.root,
      "DATA",
      "staging",
      "government_data"
    );
    this.outputRoot = path.join(
      this.stagingRoot,
      "usaspending_awards"
    );
    this.endpoint = options.endpoint || DOWNLOAD_SEARCH;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || (
      milliseconds => new Promise(resolve =>
        setTimeout(resolve, milliseconds)
      )
    );
    this.requestTimeoutMs = Number(
      options.requestTimeoutMs || 300000
    );
    this.pollIntervalMs = Number(
      options.pollIntervalMs || 10000
    );
    this.maxWaitMs = Number(
      options.maxWaitMs ||
      process.env.USASPENDING_DOWNLOAD_MAX_WAIT_MS ||
      10800000
    );
  }

  safety(externalReads = false) {
    return {
      mode: "STAGING_ONLY",
      officialSourceReads: externalReads,
      operationalWritesAllowed: false,
      orionDatabaseWrites: false,
      awardDatasetWrites: false,
      outboundInventoryWrites: false,
      taskQueueWrites: false,
      instantlyWrites: false,
      campaignWrites: false,
      emailsSent: false
    };
  }

  stagingPath(candidate, label) {
    const resolved = path.resolve(candidate);
    const relative = path.relative(this.stagingRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${label} must remain inside staging.`);
    }
    return resolved;
  }

  resolveOfficialUrl(value) {
    const url = new URL(value, this.endpoint);
    const host = url.hostname.toLowerCase();
    const official =
      host === "api.usaspending.gov" ||
      host === "files.usaspending.gov" ||
      host.endsWith(".usaspending.gov");
    if (!official || url.protocol !== "https:") {
      throw new Error(
        `USAspending returned a non-official URL: ${url.origin}`
      );
    }
    return url.toString();
  }

  resolveOptions(options = {}) {
    const startDate = isoDate(
      options.startDate || "2026-02-01"
    );
    const endDate = isoDate(options.endDate || new Date());
    if (endDate < startDate) {
      throw new Error("End date must not precede start date.");
    }
    return {
      startDate,
      endDate,
      outputRoot: this.stagingPath(
        options.outputRoot || this.outputRoot,
        "Output root"
      ),
      runId:
        options.runId ||
        `USASPENDING-AWARDS-${startDate}-TO-${endDate}-` +
        isoNow().replace(/[:.]/g, "-")
    };
  }

  requestPayload(resolved) {
    return {
      filters: {
        time_period: [
          {
            start_date: resolved.startDate,
            end_date: resolved.endDate
          }
        ],
        award_type_codes: CONTRACT_AND_IDV_CODES
      },
      spending_level: ["awards", "subawards"],
      file_format: "csv"
    };
  }

  plan(options = {}) {
    const resolved = this.resolveOptions(options);
    return {
      ok: true,
      mode: "PLAN_ONLY",
      authority: "USAspending.gov",
      endpoint: this.endpoint,
      dateRange: {
        startDate: resolved.startDate,
        endDate: resolved.endDate
      },
      scope: {
        primeAwards: true,
        subawards: true,
        assistanceAwards: false,
        contractAndIdvAwardTypeCodes: CONTRACT_AND_IDV_CODES
      },
      request: this.requestPayload(resolved),
      outputRoot: resolved.outputRoot,
      nextGate: {
        normalizeAwardAndSubawardCsvFiles: true,
        deduplicateAgainstCurrentAwardDataset: true,
        reviewMergeCounts: true,
        operationalAuthorization: false
      },
      safety: this.safety(false)
    };
  }

  async fetchResponse(url, options = {}) {
    return this.fetch(url, {
      ...options,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      headers: {
        "User-Agent": "MILES-Government-Data-Staging/1.0",
        ...(options.headers || {})
      }
    });
  }

  async requestJson(url, options = {}) {
    const officialUrl = this.resolveOfficialUrl(url);
    const response = await this.fetchResponse(
      officialUrl,
      options
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `USAspending returned HTTP ${response.status}.`
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("USAspending returned invalid JSON.");
    }
  }

  async submit(resolved) {
    return this.requestJson(this.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(this.requestPayload(resolved))
    });
  }

  async awaitDownload(submission) {
    if (!submission.status_url) {
      throw new Error(
        "USAspending did not return a status URL."
      );
    }
    const startedAt = Date.now();
    let polls = 0;
    while (Date.now() - startedAt <= this.maxWaitMs) {
      const status = await this.requestJson(
        submission.status_url,
        { headers: { Accept: "application/json" } }
      );
      polls += 1;
      const state = statusName(status);
      if (["finished", "complete", "completed"].includes(state)) {
        return { status, polls };
      }
      if (["failed", "error", "cancelled"].includes(state)) {
        throw new Error(
          `USAspending download failed: ` +
          `${status.message || state}`
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(
      `USAspending download exceeded ${this.maxWaitMs} ms.`
    );
  }

  async download(url, filePath) {
    const officialUrl = this.resolveOfficialUrl(url);
    const response = await this.fetchResponse(officialUrl, {
      headers: { Accept: "application/zip" }
    });
    if (!response.ok) {
      throw new Error(
        `USAspending file download returned HTTP ` +
        `${response.status}.`
      );
    }
    if (response.body && typeof Readable.fromWeb === "function") {
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(filePath, { flags: "wx" })
      );
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, bytes, { flag: "wx" });
    }
    const descriptor = fs.openSync(filePath, "r");
    const signature = Buffer.alloc(4);
    fs.readSync(descriptor, signature, 0, 4, 0);
    fs.closeSync(descriptor);
    if (
      signature[0] !== 0x50 ||
      signature[1] !== 0x4b
    ) {
      throw new Error(
        "USAspending artifact is not a valid ZIP container."
      );
    }
    return officialUrl;
  }

  async refresh(options = {}) {
    const resolved = this.resolveOptions(options);
    const runRoot = this.stagingPath(
      path.join(resolved.outputRoot, resolved.runId),
      "Run output"
    );
    if (fs.existsSync(runRoot)) {
      throw new Error(`Run output already exists: ${runRoot}`);
    }
    fs.mkdirSync(runRoot, { recursive: true });
    const requestPath = path.join(runRoot, "download_request.json");
    const statusPath = path.join(runRoot, "download_status.json");
    const zipPath = path.join(
      runRoot,
      "usaspending_prime_and_subawards.zip"
    );
    const mergePlanPath = path.join(
      runRoot,
      "award_dataset_merge_plan.json"
    );
    try {
      const submission = await this.submit(resolved);
      fs.writeFileSync(
        requestPath,
        JSON.stringify({
          authority: "USAspending.gov",
          requestedAt: isoNow(),
          request: this.requestPayload(resolved),
          response: submission
        }, null, 2),
        "utf8"
      );
      const completed = await this.awaitDownload(submission);
      fs.writeFileSync(
        statusPath,
        JSON.stringify(completed.status, null, 2),
        "utf8"
      );
      const downloadUrl =
        completed.status.file_url ||
        completed.status.url ||
        submission.file_url;
      if (!downloadUrl) {
        throw new Error(
          "USAspending completed without a file URL."
        );
      }
      const officialDownloadUrl = await this.download(
        downloadUrl,
        zipPath
      );
      const mergePlan = {
        generatedAt: isoNow(),
        mode: "PLAN_ONLY",
        sourceAuthority: "USAspending.gov",
        sourceArtifact: zipPath,
        sourceSha256: sha256(zipPath),
        dateRange: {
          startDate: resolved.startDate,
          endDate: resolved.endDate
        },
        target: "ORION_AWARD_DATASET",
        includedLevels: ["PRIME_AWARDS", "SUBAWARDS"],
        deduplication: {
          primePreferredKeys: [
            "generated_unique_award_id",
            "award_id_piid"
          ],
          subawardPreferredKeys: [
            "prime_award_unique_key",
            "subaward_number"
          ],
          newestAuthoritativeRecordWins: true,
          replaceOnlyAfterSuccessfulValidation: true
        },
        requiredValidation: [
          "extract every CSV without errors",
          "classify prime and subaward files",
          "verify required award identity fields",
          "deduplicate against current award dataset",
          "compare source, insert, update, and unchanged counts",
          "back up the current award dataset",
          "obtain separate operational merge approval"
        ],
        operationalWriteAuthorized: false
      };
      fs.writeFileSync(
        mergePlanPath,
        JSON.stringify(mergePlan, null, 2),
        "utf8"
      );
      const artifacts = [
        requestPath,
        statusPath,
        zipPath,
        mergePlanPath
      ].map(filePath => ({
        filePath,
        bytes: fs.statSync(filePath).size,
        sha256: sha256(filePath)
      }));
      const manifest = {
        ok: true,
        mode: "STAGING_ONLY",
        status: "COMPLETED",
        runId: resolved.runId,
        generatedAt: isoNow(),
        authority: "USAspending.gov",
        inputs: {
          endpoint: this.endpoint,
          startDate: resolved.startDate,
          endDate: resolved.endDate,
          awardTypeCodes: CONTRACT_AND_IDV_CODES,
          spendingLevels: ["awards", "subawards"],
          credentialsRequired: false
        },
        download: {
          fileName:
            completed.status.file_name ||
            submission.file_name ||
            path.basename(zipPath),
          officialDownloadUrl,
          polls: completed.polls,
          reportedRows:
            completed.status.total_rows ?? null,
          reportedSize:
            completed.status.total_size ?? null
        },
        artifacts,
        nextGate: {
          extractAndNormalize: true,
          deduplicateAgainstCurrentAwardDataset: true,
          mergeApprovalRequired: true,
          operationalAuthorization: false
        },
        safety: this.safety(true)
      };
      const manifestPath = path.join(runRoot, "manifest.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf8"
      );
      return { ...manifest, manifestPath };
    } catch (error) {
      fs.writeFileSync(
        path.join(runRoot, "failure.json"),
        JSON.stringify({
          ok: false,
          status: "FAILED",
          failedAt: isoNow(),
          error: String(error.message || error),
          safety: this.safety(true)
        }, null, 2),
        "utf8"
      );
      throw error;
    }
  }
}

UsaspendingAwardHistoryStagingService.CONTRACT_AND_IDV_CODES =
  CONTRACT_AND_IDV_CODES;
UsaspendingAwardHistoryStagingService.DOWNLOAD_SEARCH =
  DOWNLOAD_SEARCH;

module.exports = UsaspendingAwardHistoryStagingService;
