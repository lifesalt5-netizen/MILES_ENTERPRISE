"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { once } = require("events");

const isoNow = () => new Date().toISOString();
const resolvePath = value => path.resolve(value);

function isInside(parentPath, candidatePath) {
  const parent = `${resolvePath(parentPath)}${path.sep}`.toLowerCase();
  return resolvePath(candidatePath).toLowerCase().startsWith(parent);
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex").toUpperCase();
}

function freshnessKey(candidate) {
  return [
    candidate.lastUpdateDate || "",
    candidate.activationDate || "",
    candidate.registrationExpirationDate || "",
    String(Number(candidate.sourceLine) || 0).padStart(12, "0")
  ].join("|");
}

function exactMatches(candidate, allowedNaics) {
  return Array.from(
    new Set(
      (Array.isArray(candidate.naicsCodes) ? candidate.naicsCodes : [])
        .map(value => String(value || "").trim())
        .filter(value => value && allowedNaics.has(value))
    )
  ).sort();
}

async function writeJsonLine(writer, value) {
  if (!writer.write(`${JSON.stringify(value)}\n`, "utf8")) {
    await once(writer, "drain");
  }
}

function finishWriter(writer) {
  return new Promise((resolve, reject) => {
    writer.once("error", reject);
    writer.end(resolve);
  });
}

class GovernmentDataGsaMatcherService {
  constructor(options = {}) {
    this.root = resolvePath(
      options.root || process.env.MILES_ROOT || process.cwd()
    );
    this.stagingRoot = resolvePath(
      options.stagingRoot ||
        path.join(this.root, "DATA", "staging", "government_data")
    );
  }

  safety() {
    return {
      mode: "STAGING_ONLY",
      operationalWritesAllowed: false,
      orionDatabaseWrites: false,
      outboundInventoryWrites: false,
      taskQueueWrites: false,
      instantlyWrites: false,
      campaignWrites: false
    };
  }

  stagingPath(value, label) {
    const resolved = resolvePath(value);
    if (!isInside(this.stagingRoot, resolved)) {
      throw new Error(`${label} must remain inside government-data staging.`);
    }
    return resolved;
  }

  resolveOptions(options = {}) {
    if (!options.candidatesPath || !options.allowlistPath) {
      throw new Error("candidatesPath and allowlistPath are required.");
    }
    const candidatesPath = this.stagingPath(
      options.candidatesPath,
      "Candidate input"
    );
    const allowlistPath = this.stagingPath(
      options.allowlistPath,
      "GSA allowlist"
    );
    const outputRoot = this.stagingPath(
      options.outputRoot ||
        path.join(this.stagingRoot, "gsa_matching"),
      "Output root"
    );
    if (!fs.existsSync(candidatesPath)) {
      throw new Error(`Candidate input not found: ${candidatesPath}`);
    }
    if (!fs.existsSync(allowlistPath)) {
      throw new Error(`GSA allowlist not found: ${allowlistPath}`);
    }
    return {
      candidatesPath,
      allowlistPath,
      outputRoot,
      runId:
        options.runId ||
        `GSA-MATCH-${isoNow().replace(/[:.]/g, "-")}`
    };
  }

  loadAllowlist(filePath) {
    const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const allowedNaics = new Set(
      (Array.isArray(source.uniqueNaics) ? source.uniqueNaics : [])
        .map(value => String(value || "").trim())
        .filter(Boolean)
    );
    const sinsByNaics = new Map();
    for (const offering of Array.isArray(source.offerings)
      ? source.offerings
      : []) {
      for (const rawNaics of Array.isArray(offering.naicsCodes)
        ? offering.naicsCodes
        : []) {
        const naics = String(rawNaics || "").trim();
        if (!naics) continue;
        if (!sinsByNaics.has(naics)) sinsByNaics.set(naics, new Set());
        const sin = String(offering.sin || "").trim();
        if (sin) sinsByNaics.get(naics).add(sin);
      }
    }
    if (!allowedNaics.size) {
      throw new Error("GSA allowlist contains no NAICS codes.");
    }
    return { source, allowedNaics, sinsByNaics };
  }

  plan(options = {}) {
    const resolved = this.resolveOptions(options);
    const loaded = this.loadAllowlist(resolved.allowlistPath);
    return {
      ok: true,
      mode: "PLAN_ONLY",
      candidatesPath: resolved.candidatesPath,
      allowlistPath: resolved.allowlistPath,
      outputRoot: resolved.outputRoot,
      currentGsaSinCount:
        Number(loaded.source.uniqueSinCount) || null,
      currentGsaNaicsCount: loaded.allowedNaics.size,
      matching: {
        method: "EXACT_CURRENT_GSA_NAICS",
        deduplicationKey: "UEI",
        newestRecordWins: true
      },
      emailGate: {
        realVerifiedEmailRequired: true,
        sourceProvenanceRequired: true,
        guessedEmailsProhibited: true
      },
      safety: this.safety()
    };
  }

  async selectWinners(candidatesPath, allowedNaics) {
    const winners = new Map();
    const counts = {
      candidatesProcessed: 0,
      gsaMatchedInput: 0,
      noCurrentGsaNaics: 0,
      malformed: 0
    };
    const input = fs.createReadStream(candidatesPath, {
      encoding: "utf8"
    });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      counts.candidatesProcessed += 1;
      let candidate;
      try {
        candidate = JSON.parse(line);
      } catch (error) {
        counts.malformed += 1;
        throw new Error(
          `Malformed JSON at record ${counts.candidatesProcessed}: ${error.message}`
        );
      }
      if (!exactMatches(candidate, allowedNaics).length) {
        counts.noCurrentGsaNaics += 1;
        continue;
      }
      counts.gsaMatchedInput += 1;
      const uei = String(candidate.uei || "").trim();
      if (!uei) {
        throw new Error(
          `Matched candidate at source line ${candidate.sourceLine} has no UEI.`
        );
      }
      const freshness = freshnessKey(candidate);
      const current = winners.get(uei);
      if (!current || freshness > current.freshness) {
        winners.set(uei, {
          freshness,
          sourceLine: Number(candidate.sourceLine) || 0
        });
      }
    }
    return { winners, counts };
  }

  async match(options = {}) {
    const resolved = this.resolveOptions(options);
    const loaded = this.loadAllowlist(resolved.allowlistPath);
    const inputHashes = {
      candidatesSha256: hashFile(resolved.candidatesPath),
      allowlistSha256: hashFile(resolved.allowlistPath)
    };
    const first = await this.selectWinners(
      resolved.candidatesPath,
      loaded.allowedNaics
    );
    const runRoot = this.stagingPath(
      path.join(resolved.outputRoot, resolved.runId),
      "Run output"
    );
    if (fs.existsSync(runRoot)) {
      throw new Error(`Run output already exists: ${runRoot}`);
    }
    fs.mkdirSync(runRoot, { recursive: true });

    const finalPaths = {
      matched: path.join(
        runRoot,
        "sam_gsa_matched_deduped_pre_email.jsonl"
      ),
      duplicates: path.join(
        runRoot,
        "sam_gsa_duplicate_losers_index.jsonl"
      ),
      nonmatches: path.join(
        runRoot,
        "sam_not_current_gsa_naics_index.jsonl"
      )
    };
    const partialPaths = Object.fromEntries(
      Object.entries(finalPaths).map(([key, value]) => [
        key,
        `${value}.partial`
      ])
    );
    const writers = Object.fromEntries(
      Object.entries(partialPaths).map(([key, value]) => [
        key,
        fs.createWriteStream(value, {
          encoding: "utf8",
          flags: "wx"
        })
      ])
    );
    const counts = {
      candidatesProcessed: 0,
      gsaMatchedInput: first.counts.gsaMatchedInput,
      deduplicatedWinners: 0,
      duplicateLosers: 0,
      noCurrentGsaNaics: 0,
      malformed: 0,
      verifiedEmailReady: 0
    };

    try {
      const input = fs.createReadStream(resolved.candidatesPath, {
        encoding: "utf8"
      });
      const lines = readline.createInterface({
        input,
        crlfDelay: Infinity
      });
      for await (const line of lines) {
        if (!line.trim()) continue;
        counts.candidatesProcessed += 1;
        let candidate;
        try {
          candidate = JSON.parse(line);
        } catch (error) {
          counts.malformed += 1;
          throw new Error(
            `Malformed JSON at second-pass record ${counts.candidatesProcessed}: ${error.message}`
          );
        }

        const matches = exactMatches(
          candidate,
          loaded.allowedNaics
        );
        if (!matches.length) {
          counts.noCurrentGsaNaics += 1;
          await writeJsonLine(writers.nonmatches, {
            uei: candidate.uei || null,
            cageCode: candidate.cageCode || null,
            sourceLine: candidate.sourceLine || null,
            naicsCodes: Array.isArray(candidate.naicsCodes)
              ? candidate.naicsCodes
              : [],
            reason: "NO_CURRENT_GSA_NAICS_MATCH"
          });
          continue;
        }

        const uei = String(candidate.uei || "").trim();
        const winner = first.winners.get(uei);
        if (!winner) {
          throw new Error(`Winner index missing for UEI ${uei}.`);
        }
        if (Number(candidate.sourceLine) !== winner.sourceLine) {
          counts.duplicateLosers += 1;
          await writeJsonLine(writers.duplicates, {
            uei,
            cageCode: candidate.cageCode || null,
            loserSourceLine: candidate.sourceLine || null,
            winnerSourceLine: winner.sourceLine,
            reason: "OLDER_DUPLICATE_UEI_RECORD"
          });
          continue;
        }

        const matchedSins = Array.from(
          new Set(
            matches.flatMap(naics =>
              Array.from(loaded.sinsByNaics.get(naics) || [])
            )
          )
        ).sort();
        await writeJsonLine(writers.matched, {
          ...candidate,
          gsaEligibility: {
            currentGsaNaicsMatch: true,
            matchedNaics: matches,
            matchedSins,
            allowlistSha256: inputHashes.allowlistSha256
          },
          deduplication: {
            keyType: "UEI",
            keyValue: uei,
            newestSurvivor: true,
            winnerSourceLine: candidate.sourceLine
          },
          verifiedEmailGate: {
            required: true,
            verifiedEmailPresent: false,
            operationallyEligible: false,
            reason: "AWAITING_REAL_VERIFIED_EMAIL_WITH_PROVENANCE"
          }
        });
        counts.deduplicatedWinners += 1;
      }
      await Promise.all(Object.values(writers).map(finishWriter));
    } catch (error) {
      for (const writer of Object.values(writers)) {
        if (!writer.destroyed) writer.destroy();
      }
      fs.writeFileSync(
        path.join(runRoot, "failure.json"),
        JSON.stringify(
          {
            ok: false,
            status: "FAILED",
            failedAt: isoNow(),
            error: error.message,
            safety: this.safety()
          },
          null,
          2
        ),
        "utf8"
      );
      throw error;
    }

    if (
      counts.candidatesProcessed !==
        first.counts.candidatesProcessed ||
      counts.noCurrentGsaNaics !==
        first.counts.noCurrentGsaNaics ||
      counts.deduplicatedWinners !== first.winners.size ||
      counts.duplicateLosers !==
        first.counts.gsaMatchedInput - first.winners.size
    ) {
      throw new Error("Second-pass reconciliation failed.");
    }
    for (const key of Object.keys(finalPaths)) {
      fs.renameSync(partialPaths[key], finalPaths[key]);
    }
    counts.awaitingVerifiedEmail = counts.deduplicatedWinners;
    const artifacts = Object.values(finalPaths).map(filePath => ({
      filePath,
      bytes: fs.statSync(filePath).size,
      sha256: hashFile(filePath)
    }));
    const manifest = {
      ok: true,
      mode: "STAGING_ONLY",
      status: "COMPLETED",
      runId: resolved.runId,
      generatedAt: isoNow(),
      inputs: {
        candidatesPath: resolved.candidatesPath,
        allowlistPath: resolved.allowlistPath,
        ...inputHashes,
        currentGsaSinCount:
          Number(loaded.source.uniqueSinCount) || null,
        currentGsaNaicsCount: loaded.allowedNaics.size
      },
      counts,
      artifacts,
      nextGate: {
        realVerifiedEmailRequired: true,
        sourceProvenanceRequired: true,
        authorityContactPreferred: true,
        guessedEmailsProhibited: true
      },
      safety: this.safety()
    };
    const manifestPath = path.join(runRoot, "manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    return { ...manifest, manifestPath };
  }
}

module.exports = GovernmentDataGsaMatcherService;
