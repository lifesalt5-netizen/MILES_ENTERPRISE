"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_MAX_CREDITS = 7493;
const ACTIVE_STATUSES = new Set([
  "PREPARED",
  "SUBMITTED",
  "IN_PROGRESS"
]);

function isoNow() {
  return new Date().toISOString();
}

function safeRunId(prefix = "EMAIL-VERIFY") {
  return `${prefix}-${isoNow().replace(/[:.]/g, "-")}`;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ? email
    : null;
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex").toUpperCase();
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function csvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function atomicJson(filePath, value) {
  const partial = `${filePath}.partial`;
  fs.writeFileSync(partial, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(partial, filePath);
}

function artifactPath(manifest, fileName) {
  const artifact = (manifest.artifacts || []).find(item =>
    path.basename(item.filePath || "") === fileName
  );
  return artifact ? artifact.filePath : null;
}

function redact(error, secret) {
  const message = String(error && error.message ? error.message : error);
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

class MillionVerifierClient {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.singleBase =
      options.singleBase || "https://api.millionverifier.com";
    this.bulkBase =
      options.bulkBase || "https://bulkapi.millionverifier.com";
    this.timeoutMs = Number(options.timeoutMs || 120000);
  }

  async jsonRequest(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `MillionVerifier returned non-JSON status ${response.status}.`
      );
    }
    if (!response.ok || payload.error) {
      throw new Error(
        `MillionVerifier API error: ${payload.error || response.status}.`
      );
    }
    return payload;
  }

  async credits(apiKey) {
    const url =
      `${this.singleBase}/api/v3/credits?api=` +
      encodeURIComponent(apiKey);
    return this.jsonRequest(url);
  }

  async upload(apiKey, csvPath) {
    const form = new FormData();
    const bytes = fs.readFileSync(csvPath);
    form.append(
      "file_contents",
      new Blob([bytes], { type: "text/csv" }),
      path.basename(csvPath)
    );
    const url =
      `${this.bulkBase}/bulkapi/v2/upload?key=` +
      `${encodeURIComponent(apiKey)}&remove_duplicates=1`;
    return this.jsonRequest(url, { method: "POST", body: form });
  }

  async fileInfo(apiKey, fileId) {
    const url =
      `${this.bulkBase}/bulkapi/v2/fileinfo?key=` +
      `${encodeURIComponent(apiKey)}&file_id=${encodeURIComponent(fileId)}`;
    return this.jsonRequest(url);
  }

  async download(apiKey, fileId, filter) {
    const url =
      `${this.bulkBase}/bulkapi/v2/download?key=` +
      `${encodeURIComponent(apiKey)}&file_id=${encodeURIComponent(fileId)}` +
      `&filter=${encodeURIComponent(filter)}`;
    const response = await this.fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = String(
      response.headers.get("content-type") || ""
    ).toLowerCase();
    if (
      !response.ok ||
      contentType.includes("application/json") ||
      bytes.toString("utf8", 0, Math.min(bytes.length, 200))
        .trimStart()
        .startsWith("{")
    ) {
      let error = `HTTP_${response.status}`;
      try {
        const payload = JSON.parse(bytes.toString("utf8"));
        error = payload.error || error;
      } catch {}
      throw new Error(`MillionVerifier download error: ${error}.`);
    }
    return bytes;
  }
}

class MillionVerifierBulkVerificationService {
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
      "email_verification"
    );
    this.client =
      options.client || new MillionVerifierClient(options.clientOptions);
    this.sleep =
      options.sleep ||
      (milliseconds =>
        new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  safety(externalVerification = false) {
    return {
      mode: "STAGING_ONLY",
      externalVerificationUpload: externalVerification,
      operationalWritesAllowed: false,
      orionDatabaseWrites: false,
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
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`${label} must remain inside government_data staging.`);
    }
    return resolved;
  }

  findLatestRecoveryPath() {
    const recoveryRoot = path.join(
      this.stagingRoot,
      "email_recovery"
    );
    if (!fs.existsSync(recoveryRoot)) {
      throw new Error("No email recovery staging runs were found.");
    }
    const matches = [];
    for (const entry of fs.readdirSync(recoveryRoot, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(
        recoveryRoot,
        entry.name,
        "manifest.json"
      );
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        );
        if (!manifest.ok || manifest.status !== "COMPLETED") continue;
        const recoveredPath = artifactPath(
          manifest,
          "gsa_email_reverification_candidates.jsonl"
        );
        if (!recoveredPath || !fs.existsSync(recoveredPath)) continue;
        matches.push({
          generatedAt: manifest.generatedAt || "",
          filePath: recoveredPath
        });
      } catch {}
    }
    matches.sort((a, b) =>
      b.generatedAt.localeCompare(a.generatedAt)
    );
    if (!matches.length) {
      throw new Error(
        "No completed email recovery candidate artifact was found."
      );
    }
    return matches[0].filePath;
  }

  resolveInput(inputPath) {
    const resolved = inputPath
      ? this.stagingPath(inputPath, "Verification input")
      : this.stagingPath(
          this.findLatestRecoveryPath(),
          "Verification input"
        );
    if (!fs.existsSync(resolved)) {
      throw new Error(`Verification input was not found: ${resolved}`);
    }
    return resolved;
  }

  async collectAssignments(inputPath) {
    const emails = new Map();
    let candidates = 0;
    let assignments = 0;
    const input = fs.createReadStream(inputPath, { encoding: "utf8" });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const candidate = JSON.parse(line);
      candidates += 1;
      for (const contact of
        candidate.recoveredEmailMatch?.emails || []) {
        assignments += 1;
        const email = normalizeEmail(contact.email);
        if (!email) continue;
        if (!emails.has(email)) {
          emails.set(email, {
            email,
            assignmentCount: 0
          });
        }
        emails.get(email).assignmentCount += 1;
      }
    }
    return {
      emails,
      candidates,
      assignments,
      uniqueEmails: emails.size
    };
  }

  findExistingRun(inputSha256) {
    if (!fs.existsSync(this.outputRoot)) return null;
    const candidates = [];
    for (const entry of fs.readdirSync(this.outputRoot, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(
        this.outputRoot,
        entry.name,
        "manifest.json"
      );
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        );
        if (
          manifest.inputs?.candidatesSha256 === inputSha256 &&
          (
            ACTIVE_STATUSES.has(manifest.status) ||
            manifest.status === "COMPLETED" ||
            (
              manifest.status === "FAILED" &&
              manifest.provider?.fileId
            )
          )
        ) {
          candidates.push({ manifest, manifestPath });
        }
      } catch {}
    }
    candidates.sort((a, b) =>
      String(b.manifest.generatedAt || "")
        .localeCompare(String(a.manifest.generatedAt || ""))
    );
    return candidates[0] || null;
  }

  async plan(options = {}) {
    const inputPath = this.resolveInput(options.inputPath);
    const collection = await this.collectAssignments(inputPath);
    const maxCredits = Number(
      options.maxCredits || DEFAULT_MAX_CREDITS
    );
    const inputSha256 = sha256(inputPath);
    const existing = this.findExistingRun(inputSha256);
    return {
      ok: true,
      mode: "PLAN_ONLY",
      inputPath,
      inputSha256,
      recoveredCandidates: collection.candidates,
      recoveredEmailAssignments: collection.assignments,
      uniqueEmailsToVerify: collection.uniqueEmails,
      authorizedCreditCeiling: maxCredits,
      withinAuthorizedCreditCeiling:
        collection.uniqueEmails <= maxCredits,
      apiKeyConfigured: Boolean(options.apiKey),
      resumableRun: existing
        ? {
            runId: existing.manifest.runId,
            status: existing.manifest.status,
            providerFileId:
              existing.manifest.provider?.fileId || null
          }
        : null,
      safety: this.safety(false)
    };
  }

  writeUploadCsv(filePath, emails) {
    const partial = `${filePath}.partial`;
    const lines = ["email"];
    for (const email of Array.from(emails.keys()).sort()) {
      lines.push(csvCell(email));
    }
    fs.writeFileSync(partial, `${lines.join("\n")}\n`, "utf8");
    fs.renameSync(partial, filePath);
  }

  async extractOkEmails(reportPath, submittedEmails) {
    const ok = new Set();
    const input = fs.createReadStream(reportPath, { encoding: "utf8" });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity
    });
    for await (const line of lines) {
      for (const value of parseCsvLine(line)) {
        const email = normalizeEmail(value);
        if (email && submittedEmails.has(email)) {
          ok.add(email);
        }
      }
    }
    return ok;
  }

  async writeVerifiedArtifacts(options) {
    const {
      inputPath,
      okEmails,
      runRoot,
      fileId,
      providerInfo,
      reportSha256
    } = options;
    const verifiedPath = path.join(
      runRoot,
      "gsa_freshly_verified_ok.jsonl"
    );
    const rejectedPath = path.join(
      runRoot,
      "gsa_not_freshly_verified_index.jsonl"
    );
    const verifiedPartial = `${verifiedPath}.partial`;
    const rejectedPartial = `${rejectedPath}.partial`;
    const verifiedWriter = fs.createWriteStream(verifiedPartial, {
      encoding: "utf8",
      flags: "wx"
    });
    const rejectedWriter = fs.createWriteStream(rejectedPartial, {
      encoding: "utf8",
      flags: "wx"
    });
    const counts = {
      candidatesProcessed: 0,
      companiesWithFreshOkEmail: 0,
      companiesWithoutFreshOkEmail: 0,
      freshOkAssignments: 0
    };
    const input = fs.createReadStream(inputPath, { encoding: "utf8" });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const candidate = JSON.parse(line);
      counts.candidatesProcessed += 1;
      const contacts =
        candidate.recoveredEmailMatch?.emails || [];
      const freshContacts = contacts
        .filter(contact => okEmails.has(normalizeEmail(contact.email)))
        .map(contact => ({
          ...contact,
          freshVerification: {
            provider: "MillionVerifier",
            result: "ok",
            fileId: String(fileId),
            verifiedAt: isoNow(),
            reportSha256
          }
        }));
      if (!freshContacts.length) {
        counts.companiesWithoutFreshOkEmail += 1;
        rejectedWriter.write(
          `${JSON.stringify({
            uei: candidate.uei || null,
            cageCode: candidate.cageCode || null,
            legalBusinessName: candidate.legalBusinessName || null,
            reason: "NO_FRESH_MILLIONVERIFIER_OK_EMAIL"
          })}\n`
        );
        continue;
      }
      counts.companiesWithFreshOkEmail += 1;
      counts.freshOkAssignments += freshContacts.length;
      verifiedWriter.write(
        `${JSON.stringify({
          ...candidate,
          recoveredEmailMatch: {
            ...candidate.recoveredEmailMatch,
            emails: freshContacts
          },
          verifiedEmailGate: {
            required: true,
            historicalVerifiedEmailPresent: true,
            freshVerificationPresent: true,
            freshVerificationProvider: "MillionVerifier",
            acceptedResult: "ok",
            operationallyEligible: false,
            reason: "AWAITING_OPERATIONAL_IMPORT_APPROVAL"
          }
        })}\n`
      );
    }
    await Promise.all([
      new Promise((resolve, reject) => {
        verifiedWriter.on("error", reject);
        verifiedWriter.end(resolve);
      }),
      new Promise((resolve, reject) => {
        rejectedWriter.on("error", reject);
        rejectedWriter.end(resolve);
      })
    ]);
    fs.renameSync(verifiedPartial, verifiedPath);
    fs.renameSync(rejectedPartial, rejectedPath);
    return {
      counts,
      artifacts: [verifiedPath, rejectedPath].map(filePath => ({
        filePath,
        bytes: fs.statSync(filePath).size,
        sha256: sha256(filePath)
      })),
      providerInfo
    };
  }

  async verify(options = {}) {
    if (!options.authorizeCreditUse) {
      throw new Error(
        "Credit use is not authorized. Pass --authorize-credit-use."
      );
    }
    const apiKey = String(options.apiKey || "").trim();
    if (!apiKey) {
      throw new Error(
        "MILLIONVERIFIER_API_KEY is not configured."
      );
    }
    const inputPath = this.resolveInput(options.inputPath);
    const inputSha256 = sha256(inputPath);
    const collection = await this.collectAssignments(inputPath);
    const maxCredits = Number(
      options.maxCredits || DEFAULT_MAX_CREDITS
    );
    if (
      !Number.isInteger(maxCredits) ||
      maxCredits < 1 ||
      maxCredits > DEFAULT_MAX_CREDITS
    ) {
      throw new Error(
        `Credit ceiling must be between 1 and ${DEFAULT_MAX_CREDITS}.`
      );
    }
    if (collection.uniqueEmails > maxCredits) {
      throw new Error(
        `${collection.uniqueEmails} unique emails exceed the authorized ` +
        `${maxCredits}-credit ceiling.`
      );
    }

    let existing = this.findExistingRun(inputSha256);
    if (existing?.manifest.status === "COMPLETED") {
      return { ...existing.manifest, reusedCompletedRun: true };
    }

    let manifest;
    let manifestPath;
    let runRoot;
    if (existing) {
      ({ manifest, manifestPath } = existing);
      runRoot = path.dirname(manifestPath);
    } else {
      const creditsBefore = await this.client.credits(apiKey);
      const availableCredits = Number(
        creditsBefore.bulk_credits ?? creditsBefore.credits ?? 0
      );
      if (availableCredits < collection.uniqueEmails) {
        throw new Error(
          `MillionVerifier has ${availableCredits} credits but ` +
          `${collection.uniqueEmails} are required.`
        );
      }
      const runId = options.runId || safeRunId();
      runRoot = this.stagingPath(
        path.join(this.outputRoot, runId),
        "Verification run output"
      );
      if (fs.existsSync(runRoot)) {
        throw new Error(`Verification run already exists: ${runRoot}`);
      }
      fs.mkdirSync(runRoot, { recursive: true });
      const uploadPath = path.join(
        runRoot,
        "millionverifier_upload.csv"
      );
      this.writeUploadCsv(uploadPath, collection.emails);
      manifestPath = path.join(runRoot, "manifest.json");
      manifest = {
        ok: true,
        mode: "STAGING_ONLY",
        status: "PREPARED",
        runId,
        generatedAt: isoNow(),
        updatedAt: isoNow(),
        inputs: {
          candidatesPath: inputPath,
          candidatesSha256: inputSha256,
          recoveredCandidates: collection.candidates,
          recoveredEmailAssignments: collection.assignments,
          uniqueEmailsSubmitted: collection.uniqueEmails,
          uploadPath,
          uploadSha256: sha256(uploadPath)
        },
        authorization: {
          authorized: true,
          authorizedCreditCeiling: maxCredits
        },
        provider: {
          name: "MillionVerifier",
          creditsBefore: availableCredits,
          fileId: null
        },
        safety: this.safety(true)
      };
      atomicJson(manifestPath, manifest);
    }

    try {
      if (!manifest.provider?.fileId) {
        const upload = await this.client.upload(
          apiKey,
          manifest.inputs.uploadPath
        );
        if (!upload.file_id) {
          throw new Error("MillionVerifier did not return a file_id.");
        }
        manifest.status = "SUBMITTED";
        manifest.updatedAt = isoNow();
        manifest.provider.fileId = String(upload.file_id);
        manifest.provider.upload = {
          status: upload.status || null,
          uniqueEmails: Number(upload.unique_emails || 0),
          totalRows: Number(upload.total_rows || 0)
        };
        atomicJson(manifestPath, manifest);
      }

      const pollIntervalMs = Number(options.pollIntervalMs || 10000);
      const maxWaitMs = Number(options.maxWaitMs || 7200000);
      const started = Date.now();
      let providerInfo;
      while (true) {
        providerInfo = await this.client.fileInfo(
          apiKey,
          manifest.provider.fileId
        );
        manifest.status = "IN_PROGRESS";
        manifest.updatedAt = isoNow();
        manifest.provider.progress = {
          status: providerInfo.status,
          percent: Number(providerInfo.percent || 0),
          estimatedTimeSeconds:
            Number(providerInfo.estimated_time_sec || 0)
        };
        atomicJson(manifestPath, manifest);
        if (typeof options.onProgress === "function") {
          options.onProgress(manifest.provider.progress);
        }
        if (providerInfo.status === "finished") break;
        if (
          providerInfo.status === "canceled" ||
          providerInfo.status === "error"
        ) {
          throw new Error(
            `MillionVerifier job ended with status ${providerInfo.status}.`
          );
        }
        if (Date.now() - started >= maxWaitMs) {
          manifest.status = "IN_PROGRESS";
          manifest.updatedAt = isoNow();
          manifest.resumeRequired = true;
          atomicJson(manifestPath, manifest);
          return manifest;
        }
        await this.sleep(pollIntervalMs);
      }

      const allReportPath = path.join(
        runRoot,
        "millionverifier_all_results.csv"
      );
      const okReportPath = path.join(
        runRoot,
        "millionverifier_ok_results.csv"
      );
      fs.writeFileSync(
        allReportPath,
        await this.client.download(
          apiKey,
          manifest.provider.fileId,
          "all"
        )
      );
      fs.writeFileSync(
        okReportPath,
        await this.client.download(
          apiKey,
          manifest.provider.fileId,
          "ok"
        )
      );
      const okEmails = await this.extractOkEmails(
        okReportPath,
        collection.emails
      );
      const reportSha256 = sha256(allReportPath);
      const outputs = await this.writeVerifiedArtifacts({
        inputPath,
        okEmails,
        runRoot,
        fileId: manifest.provider.fileId,
        providerInfo,
        reportSha256
      });
      const creditsAfter = await this.client.credits(apiKey);
      const remainingCredits = Number(
        creditsAfter.bulk_credits ?? creditsAfter.credits ?? 0
      );
      const rawArtifacts = [allReportPath, okReportPath].map(
        filePath => ({
          filePath,
          bytes: fs.statSync(filePath).size,
          sha256: sha256(filePath)
        })
      );
      manifest.status = "COMPLETED";
      manifest.completedAt = isoNow();
      manifest.updatedAt = isoNow();
      manifest.provider.final = {
        status: providerInfo.status,
        totalRows: Number(providerInfo.total_rows || 0),
        uniqueEmails: Number(providerInfo.unique_emails || 0),
        ok: Number(providerInfo.ok || okEmails.size),
        catchAll: Number(providerInfo.catch_all || 0),
        disposable: Number(providerInfo.disposable || 0),
        invalid: Number(providerInfo.invalid || 0),
        unknown: Number(providerInfo.unknown || 0),
        creditsAfter: remainingCredits,
        creditsConsumed:
          manifest.provider.creditsBefore - remainingCredits
      };
      manifest.counts = {
        ...outputs.counts,
        uniqueEmailsSubmitted: collection.uniqueEmails,
        uniqueFreshOkEmails: okEmails.size
      };
      manifest.artifacts = [...rawArtifacts, ...outputs.artifacts];
      manifest.nextGate = {
        operationalImportApprovalRequired: true,
        onlyMillionVerifierOkRetained: true,
        catchAllRejected: true,
        unknownRejected: true,
        disposableRejected: true,
        invalidRejected: true,
        operationalAuthorization: false
      };
      atomicJson(manifestPath, manifest);
      return { ...manifest, manifestPath };
    } catch (error) {
      manifest.status = "FAILED";
      manifest.updatedAt = isoNow();
      manifest.error = redact(error, apiKey);
      manifest.resumeSafe =
        Boolean(manifest.provider?.fileId);
      atomicJson(manifestPath, manifest);
      throw new Error(manifest.error);
    }
  }
}

MillionVerifierBulkVerificationService.Client =
  MillionVerifierClient;
MillionVerifierBulkVerificationService.DEFAULT_MAX_CREDITS =
  DEFAULT_MAX_CREDITS;

module.exports = MillionVerifierBulkVerificationService;
