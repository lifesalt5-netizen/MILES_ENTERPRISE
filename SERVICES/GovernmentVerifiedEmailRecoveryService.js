"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { once } = require("events");

const TRUSTED_FILE_PATTERNS = [
  /^SBS_VALIDATED_EMAIL_TARGETS(?:_EMAIL_READY)?\.csv$/i,
  /^SBS_FILTERED_TARGETS_OK_ONLY_MILLIONVERIFIER\.csv$/i,
  /_EMAIL_READY\.csv$/i,
  /^MASTER_DEDUPED_ALL_SEGMENTS\.csv$/i
];

const BLOCKED_TLDS = new Set([
  "org",
  "edu",
  "gov",
  "mil",
  "int",
  "ngo",
  "foundation",
  "church",
  "museum"
]);

const BLOCKED_LOCAL_PARTS = [
  /^no[._-]?reply$/i,
  /^do[._-]?not[._-]?reply$/i,
  /^(support|help|helpdesk|service|customerservice)$/i,
  /^(careers?|jobs?|recruiting|recruitment|humanresources|hr)$/i,
  /^(billing|accounting|accounts|invoice|invoices|payables?|receivables?)$/i,
  /^(abuse|postmaster|webmaster|privacy|security)$/i
];

const EMAIL_HEADERS = new Set([
  "email",
  "emailaddress",
  "contactemail",
  "contactpersonsemail",
  "normemail"
]);
const UEI_HEADERS = new Set([
  "uei",
  "ueisam",
  "uniqueentityidentifier"
]);
const CAGE_HEADERS = new Set(["cage", "cagecode"]);
const COMPANY_HEADERS = new Set([
  "company",
  "companynorm",
  "legalname",
  "legalbusinessname",
  "nameclean"
]);
const STATE_HEADERS = new Set(["state", "physicaladdressstate"]);
const POSTAL_HEADERS = new Set([
  "zip",
  "zipcode",
  "postalcode",
  "physicaladdresspostalcode"
]);
const DOMAIN_HEADERS = new Set([
  "website",
  "websitedomain",
  "domain",
  "emaildomain"
]);
const TITLE_HEADERS = new Set([
  "title",
  "jobtitle",
  "poctitle",
  "contacttitle"
]);
const NAME_HEADERS = new Set([
  "contactname",
  "pocname",
  "fullname",
  "firstname",
  "lastname"
]);
const STATUS_HEADERS = new Set([
  "verificationstatus",
  "emailstatus",
  "emailverificationstatus",
  "deliverability",
  "result",
  "status"
]);

const isoNow = () => new Date().toISOString();

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeDomain(value) {
  let text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  text = text.replace(/^https?:\/\//, "").replace(/^www\./, "");
  text = text.split(/[/?#]/)[0];
  if (text.includes("@")) text = text.split("@").pop();
  return text.replace(/\.+$/, "");
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || "").trim());
}

function emailPolicy(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!validEmail(normalized)) {
    return { accepted: false, reason: "INVALID_EMAIL_SYNTAX" };
  }
  const [local, domain] = normalized.split("@");
  const tld = domain.split(".").pop();
  if (BLOCKED_TLDS.has(tld)) {
    return { accepted: false, reason: "BLOCKED_INSTITUTIONAL_DOMAIN" };
  }
  if (BLOCKED_LOCAL_PARTS.some(pattern => pattern.test(local))) {
    return { accepted: false, reason: "BLOCKED_NON_BUYER_MAILBOX" };
  }
  return { accepted: true, email: normalized, local, domain };
}

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  fields.push(value);
  return fields;
}

function firstValue(fields, indexes) {
  for (const index of indexes) {
    const value = String(fields[index] || "").trim();
    if (value) return value;
  }
  return "";
}

function allValues(fields, indexes) {
  return indexes
    .map(index => String(fields[index] || "").trim())
    .filter(Boolean);
}

function indexesFor(headers, accepted) {
  const indexes = [];
  headers.forEach((header, index) => {
    if (accepted.has(normalizeHeader(header))) indexes.push(index);
  });
  return indexes;
}

function explicitVerifiedFile(fileName) {
  return /MILLIONVERIFIER|VALIDATED_EMAIL_TARGETS/i.test(fileName);
}

function emailReadyFile(fileName) {
  return /_EMAIL_READY\.csv$/i.test(fileName);
}

function rowHasVerifiedStatus(fields, statusIndexes) {
  return allValues(fields, statusIndexes).some(value =>
    /^(valid|verified|deliverable|ok|good|safe)$/i.test(value)
  );
}

function matchKeys(record) {
  const keys = [];
  if (record.uei) keys.push(`UEI:${normalizeText(record.uei)}`);
  if (record.cage) keys.push(`CAGE:${normalizeText(record.cage)}`);
  if (record.domain) keys.push(`DOMAIN:${normalizeDomain(record.domain)}`);
  if (record.company && record.state && record.postal) {
    keys.push(
      `NAME_STATE_POSTAL:${normalizeText(record.company)}:${normalizeText(
        record.state
      )}:${normalizeText(record.postal)}`
    );
  }
  return keys.filter(value => !value.endsWith(":"));
}

function candidateKeys(candidate) {
  return matchKeys({
    uei: candidate.uei,
    cage: candidate.cageCode,
    domain: candidate.websiteDomain || candidate.website,
    company: candidate.legalBusinessName,
    state: candidate.physicalAddress?.state,
    postal: candidate.physicalAddress?.postalCode
  });
}

function authorityScore(record) {
  const title = String(record.title || "").toLowerCase();
  const local = String(record.email || "").split("@")[0].toLowerCase();
  if (
    /owner|chief executive|\bceo\b|founder|president|managing member|managing partner|\bprincipal\b/.test(
      title
    )
  ) {
    return 100;
  }
  if (
    /\bcoo\b|\bcgo\b|growth|federal|govcon|government|contracts?|capture|business development|\bbd\b/.test(
      title
    )
  ) {
    return 85;
  }
  if (
    /^(contracts?|capture|federal|govcon|government|businessdevelopment|bd|sales)$/.test(
      local.replace(/[._-]/g, "")
    )
  ) {
    return 60;
  }
  if (/^(info|contact|office|hello)$/.test(local)) return 30;
  return record.contactName ? 70 : 50;
}

function sha256(filePath) {
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

class GovernmentVerifiedEmailRecoveryService {
  constructor(options = {}) {
    this.root = path.resolve(
      options.root || process.env.MILES_ROOT || process.cwd()
    );
    this.stagingRoot = path.resolve(
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
      campaignWrites: false,
      emailsSent: false
    };
  }

  stagingPath(value, label) {
    const resolved = path.resolve(value);
    const parent = `${this.stagingRoot}${path.sep}`.toLowerCase();
    if (!resolved.toLowerCase().startsWith(parent)) {
      throw new Error(`${label} must remain inside government-data staging.`);
    }
    return resolved;
  }

  defaultSearchRoots() {
    const roots = [
      path.dirname(this.root),
      path.join(
        path.dirname(this.root),
        "Good Files to use",
        "Good To Use and segmented"
      ),
      path.join(path.dirname(this.root), "Good Files to use"),
      path.join(this.root, "DATA")
    ];
    if (process.platform === "win32") {
      const systemDrive = process.env.SystemDrive || "C:";
      roots.push(
        path.join(
          `${systemDrive}${path.sep}`,
          "MILES_RECOVERY_20260727"
        )
      );
    }
    return Array.from(
      new Set(roots.map(value => path.resolve(value)))
    ).filter(value => fs.existsSync(value));
  }

  findTrustedCsvFiles(searchRoots) {
    const found = new Set();
    const ignored = new Set([
      ".git",
      "node_modules",
      "_LEGACY_BUILDS",
      "government_data"
    ]);
    const visit = directory => {
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name)) visit(fullPath);
        } else if (
          entry.isFile() &&
          TRUSTED_FILE_PATTERNS.some(pattern => pattern.test(entry.name))
        ) {
          found.add(path.resolve(fullPath));
        }
      }
    };
    searchRoots.forEach(visit);
    return Array.from(found).sort();
  }

  latestCandidatesPath() {
    const matchingRoot = path.join(this.stagingRoot, "gsa_matching");
    if (!fs.existsSync(matchingRoot)) {
      throw new Error("No GSA matching runs were found.");
    }
    const manifests = [];
    for (const entry of fs.readdirSync(matchingRoot, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(
        matchingRoot,
        entry.name,
        "manifest.json"
      );
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        );
        if (manifest.ok && manifest.status === "COMPLETED") {
          const artifact = (manifest.artifacts || []).find(item =>
            String(item.filePath || "").endsWith(
              "sam_gsa_matched_deduped_pre_email.jsonl"
            )
          );
          if (artifact && fs.existsSync(artifact.filePath)) {
            manifests.push({
              generatedAt: manifest.generatedAt || "",
              filePath: artifact.filePath
            });
          }
        }
      } catch {}
    }
    manifests.sort((a, b) =>
      b.generatedAt.localeCompare(a.generatedAt)
    );
    if (!manifests.length) {
      throw new Error("No completed GSA candidate artifact was found.");
    }
    return path.resolve(manifests[0].filePath);
  }

  resolveOptions(options = {}) {
    const candidatesPath = this.stagingPath(
      options.candidatesPath || this.latestCandidatesPath(),
      "Candidate input"
    );
    const outputRoot = this.stagingPath(
      options.outputRoot ||
        path.join(this.stagingRoot, "email_recovery"),
      "Output root"
    );
    const searchRoots = (
      options.searchRoots?.length
        ? options.searchRoots
        : this.defaultSearchRoots()
    )
      .map(value => path.resolve(value))
      .filter(value => fs.existsSync(value));
    if (!fs.existsSync(candidatesPath)) {
      throw new Error(`Candidate input not found: ${candidatesPath}`);
    }
    if (!searchRoots.length) {
      throw new Error("No verified-email search roots were found.");
    }
    return {
      candidatesPath,
      outputRoot,
      searchRoots,
      runId:
        options.runId ||
        `EMAIL-RECOVERY-${isoNow().replace(/[:.]/g, "-")}`
    };
  }

  plan(options = {}) {
    const resolved = this.resolveOptions(options);
    const files = this.findTrustedCsvFiles(resolved.searchRoots);
    return {
      ok: true,
      mode: "PLAN_ONLY",
      candidatesPath: resolved.candidatesPath,
      searchRoots: resolved.searchRoots,
      trustedCsvFilesFound: files.length,
      trustedCsvFiles: files,
      outputRoot: resolved.outputRoot,
      rules: {
        identityPrecedence: [
          "UEI",
          "CAGE",
          "EXACT_DOMAIN",
          "EXACT_LEGAL_NAME_STATE_POSTAL"
        ],
        guessedEmailsProhibited: true,
        freshReverificationRequired: true
      },
      safety: this.safety()
    };
  }

  async buildEmailIndex(files) {
    const index = new Map();
    const uniqueEmails = new Set();
    const inventory = [];
    const rejectionReasons = {};
    let rowsScanned = 0;
    let recoveredRows = 0;

    const reject = reason => {
      rejectionReasons[reason] =
        (rejectionReasons[reason] || 0) + 1;
    };

    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const fileHash = sha256(filePath);
      const input = fs.createReadStream(filePath, {
        encoding: "utf8"
      });
      const lines = readline.createInterface({
        input,
        crlfDelay: Infinity
      });
      let headers = null;
      let indexes = null;
      let sourceLine = 0;
      let fileRows = 0;
      let fileRecovered = 0;

      for await (const line of lines) {
        sourceLine += 1;
        if (!headers) {
          headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
          indexes = {
            email: indexesFor(headers, EMAIL_HEADERS),
            uei: indexesFor(headers, UEI_HEADERS),
            cage: indexesFor(headers, CAGE_HEADERS),
            company: indexesFor(headers, COMPANY_HEADERS),
            state: indexesFor(headers, STATE_HEADERS),
            postal: indexesFor(headers, POSTAL_HEADERS),
            domain: indexesFor(headers, DOMAIN_HEADERS),
            title: indexesFor(headers, TITLE_HEADERS),
            name: indexesFor(headers, NAME_HEADERS),
            status: indexesFor(headers, STATUS_HEADERS)
          };
          continue;
        }
        if (!line.trim()) continue;
        rowsScanned += 1;
        fileRows += 1;
        const fields = parseCsvLine(line);
        const trustedByFile =
          explicitVerifiedFile(fileName) || emailReadyFile(fileName);
        const trustedByStatus = rowHasVerifiedStatus(
          fields,
          indexes.status
        );
        if (!trustedByFile && !trustedByStatus) {
          reject("NO_VERIFICATION_EVIDENCE");
          continue;
        }
        const identity = {
          uei: firstValue(fields, indexes.uei),
          cage: firstValue(fields, indexes.cage),
          company: firstValue(fields, indexes.company),
          state: firstValue(fields, indexes.state),
          postal: firstValue(fields, indexes.postal),
          domain: firstValue(fields, indexes.domain)
        };
        const keys = matchKeys(identity);
        if (!keys.length) {
          reject("NO_EXACT_IDENTITY_KEY");
          continue;
        }
        for (const rawEmail of allValues(fields, indexes.email)) {
          const policy = emailPolicy(rawEmail);
          if (!policy.accepted) {
            reject(policy.reason);
            continue;
          }
          const record = {
            email: policy.email,
            contactName: firstValue(fields, indexes.name) || null,
            title: firstValue(fields, indexes.title) || null,
            sourceFile: filePath,
            sourceFileSha256: fileHash,
            sourceLine,
            verificationEvidence: explicitVerifiedFile(fileName)
              ? "EXPLICIT_VERIFIED_REPOSITORY"
              : emailReadyFile(fileName)
                ? "EMAIL_READY_REPOSITORY"
                : "ROW_VERIFICATION_STATUS",
            historicalVerificationOnly: true,
            freshReverificationRequired: true
          };
          record.authorityScore = authorityScore(record);
          uniqueEmails.add(record.email);
          recoveredRows += 1;
          fileRecovered += 1;
          for (const key of keys) {
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(record);
          }
        }
      }
      inventory.push({
        filePath,
        sha256: fileHash,
        rowsScanned: fileRows,
        recoveredEmailRows: fileRecovered
      });
    }
    return {
      index,
      inventory,
      counts: {
        filesScanned: files.length,
        rowsScanned,
        recoveredEmailRows: recoveredRows,
        uniqueRecoveredEmails: uniqueEmails.size,
        rejectionReasons
      }
    };
  }

  async recover(options = {}) {
    const resolved = this.resolveOptions(options);
    const files = this.findTrustedCsvFiles(resolved.searchRoots);
    if (!files.length) {
      throw new Error("No trusted verified-email CSV files were found.");
    }
    const emailIndex = await this.buildEmailIndex(files);
    const runRoot = this.stagingPath(
      path.join(resolved.outputRoot, resolved.runId),
      "Run output"
    );
    if (fs.existsSync(runRoot)) {
      throw new Error(`Run output already exists: ${runRoot}`);
    }
    fs.mkdirSync(runRoot, { recursive: true });
    const finalPaths = {
      recovered: path.join(
        runRoot,
        "gsa_email_reverification_candidates.jsonl"
      ),
      unmatched: path.join(
        runRoot,
        "gsa_candidates_without_recovered_email_index.jsonl"
      ),
      inventory: path.join(runRoot, "email_source_inventory.json")
    };
    const recoveredPartial = `${finalPaths.recovered}.partial`;
    const unmatchedPartial = `${finalPaths.unmatched}.partial`;
    const recoveredWriter = fs.createWriteStream(recoveredPartial, {
      encoding: "utf8",
      flags: "wx"
    });
    const unmatchedWriter = fs.createWriteStream(unmatchedPartial, {
      encoding: "utf8",
      flags: "wx"
    });
    const counts = {
      candidatesProcessed: 0,
      candidatesWithRecoveredEmail: 0,
      candidatesWithoutRecoveredEmail: 0,
      recoveredEmailAssignments: 0,
      freshVerifiedEmailReady: 0,
      malformed: 0
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
            `Malformed candidate JSON at record ${counts.candidatesProcessed}: ${error.message}`
          );
        }
        const keys = candidateKeys(candidate);
        let matchedBy = null;
        let records = [];
        for (const prefix of [
          "UEI:",
          "CAGE:",
          "DOMAIN:",
          "NAME_STATE_POSTAL:"
        ]) {
          const tierRecords = keys
            .filter(key => key.startsWith(prefix))
            .flatMap(key => emailIndex.index.get(key) || []);
          if (tierRecords.length) {
            matchedBy = prefix.slice(0, -1);
            records = tierRecords;
            break;
          }
        }
        const bestByEmail = new Map();
        for (const record of records) {
          const current = bestByEmail.get(record.email);
          if (!current || record.authorityScore > current.authorityScore) {
            bestByEmail.set(record.email, record);
          }
        }
        const recoveredEmails = Array.from(bestByEmail.values()).sort(
          (a, b) =>
            b.authorityScore - a.authorityScore ||
            a.email.localeCompare(b.email)
        );

        if (!recoveredEmails.length) {
          counts.candidatesWithoutRecoveredEmail += 1;
          await writeJsonLine(unmatchedWriter, {
            uei: candidate.uei || null,
            cageCode: candidate.cageCode || null,
            legalBusinessName: candidate.legalBusinessName || null,
            websiteDomain: candidate.websiteDomain || null,
            reason: "NO_TRUSTED_HISTORICALLY_VERIFIED_EMAIL_MATCH"
          });
          continue;
        }
        counts.candidatesWithRecoveredEmail += 1;
        counts.recoveredEmailAssignments += recoveredEmails.length;
        await writeJsonLine(recoveredWriter, {
          ...candidate,
          recoveredEmailMatch: {
            matchedBy,
            emails: recoveredEmails,
            guessedEmailsUsed: false
          },
          verifiedEmailGate: {
            required: true,
            historicalVerifiedEmailPresent: true,
            freshVerificationPresent: false,
            operationallyEligible: false,
            reason: "FRESH_REVERIFICATION_REQUIRED_BEFORE_OUTBOUND"
          }
        });
      }
      await Promise.all([
        finishWriter(recoveredWriter),
        finishWriter(unmatchedWriter)
      ]);
    } catch (error) {
      if (!recoveredWriter.destroyed) recoveredWriter.destroy();
      if (!unmatchedWriter.destroyed) unmatchedWriter.destroy();
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
        )
      );
      throw error;
    }
    fs.renameSync(recoveredPartial, finalPaths.recovered);
    fs.renameSync(unmatchedPartial, finalPaths.unmatched);
    fs.writeFileSync(
      finalPaths.inventory,
      JSON.stringify(
        {
          generatedAt: isoNow(),
          searchRoots: resolved.searchRoots,
          inventory: emailIndex.inventory,
          counts: emailIndex.counts
        },
        null,
        2
      ),
      "utf8"
    );
    const artifacts = Object.values(finalPaths).map(filePath => ({
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
      inputs: {
        candidatesPath: resolved.candidatesPath,
        candidatesSha256: sha256(resolved.candidatesPath),
        trustedCsvFiles: files.length
      },
      sourceCounts: emailIndex.counts,
      counts,
      artifacts,
      nextGate: {
        freshEmailReverificationRequired: true,
        authorityContactPreferred: true,
        guessedEmailsProhibited: true,
        operationalAuthorization: false
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

module.exports = GovernmentVerifiedEmailRecoveryService;
module.exports.parseCsvLine = parseCsvLine;
module.exports.emailPolicy = emailPolicy;
