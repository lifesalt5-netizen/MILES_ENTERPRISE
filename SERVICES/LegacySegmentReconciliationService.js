"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { once } = require("events");

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
const COMPANY_ID_HEADERS = new Set([
  "companyid",
  "contractorid",
  "entityid"
]);
const COMPANY_HEADERS = new Set([
  "company",
  "companynorm",
  "legalname",
  "legalbusinessname",
  "nameclean"
]);
const NAICS_HEADERS = new Set([
  "primarynaics",
  "allnaics",
  "allmatchednaics",
  "naics",
  "naicscodes"
]);
const SEGMENT_HEADERS = new Set([
  "campaignname",
  "segment",
  "existingsegment",
  "vehicle",
  "vehiclehint",
  "setasideraw"
]);
const EXPIRATION_HEADERS = new Set([
  "expirationdate",
  "expirationdateraw",
  "contractexpirationdate"
]);
const GSA_START_HEADERS = new Set([
  "firstgsaawarddate",
  "gsaawarddate",
  "gsacontractstartdate",
  "scheduleawarddate",
  "schedulecontractstartdate",
  "contractawarddate"
]);
const REVENUE_HEADERS = new Set([
  "federalrevenue",
  "gsarevenue",
  "schedulesales",
  "gsasales"
]);
const GSA_CONTRACT_HEADERS = new Set([
  "gsacontractnumber",
  "schedulecontractnumber",
  "contractnumber"
]);
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
const BLOCKED_ENTITY_WORDS = [
  /\b(church|ministry|diocese|synagogue|mosque)\b/i,
  /\b(university|college|school|academy|education district)\b/i,
  /\b(hotel|motel|inn|resort)\b/i,
  /\b(mortgage|investment|hedge fund)\b/i,
  /\b(dog walk|car ?wash|fast food|nail salon|hair salon|massage)\b/i
];
const SEGMENT_PRECEDENCE = [
  "New GSA Holders This Month",
  "GSA No Sales - 1 Year or Less",
  "GSA No Sales - 1 to 2 Years",
  "GSA No Sales - 2 to 3 Years",
  "GSA No Sales - 3+ Years",
  "GSA No Sales - Tenure Unknown",
  "Expired Everything",
  "Expiring 6 Months",
  "Expiring 12 Months",
  "GSA",
  "VA",
  "SAM",
  "Certifications",
  "SBS"
];

function isoNow() {
  return new Date().toISOString();
}

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

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ? email
    : null;
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

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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

function indexesFor(headers, accepted) {
  const indexes = [];
  headers.forEach((header, index) => {
    if (accepted.has(normalizeHeader(header))) indexes.push(index);
  });
  return indexes;
}

function valuesAt(fields, indexes) {
  return indexes
    .map(index => String(fields[index] || "").trim())
    .filter(Boolean);
}

function firstAt(fields, indexes) {
  return valuesAt(fields, indexes)[0] || "";
}

function extractNaics(values) {
  return Array.from(
    new Set(
      values.flatMap(value =>
        Array.from(
          String(value || "").matchAll(/(?<!\d)\d{6}(?!\d)/g),
          match => match[0]
        )
      )
    )
  ).sort();
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberValue(values) {
  for (const value of values || []) {
    const normalized = String(value || "").replace(/[$,\s]/g, "");
    if (normalized && Number.isFinite(Number(normalized))) {
      return Number(normalized);
    }
  }
  return null;
}

function sameUtcMonth(left, right) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth()
  );
}

function emailDisposition(email, verificationResults) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "INVALID_SYNTAX";
  const tld = normalized.split("@").pop().split(".").pop();
  if (BLOCKED_TLDS.has(tld)) return "PROHIBITED_DOMAIN";
  return verificationResults.get(normalized) || "NOT_FRESHLY_VERIFIED";
}

function segmentTags(record, now = new Date()) {
  const text = [
    ...(record.segmentValues || []),
    record.legalBusinessName,
    ...(record.certificationValues || [])
  ]
    .filter(Boolean)
    .join(" ");
  const tags = new Set();
  const gsaStartDates = (record.gsaStartValues || [])
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const firstGsaAwardDate = gsaStartDates[0] || null;
  const federalRevenue = numberValue(record.revenueValues);
  const explicitNewHolder =
    /\bnew\s+GSA\s+(?:schedule\s+)?holder\b/i.test(text);
  const gsaHolderSignal =
    Boolean(firstGsaAwardDate) ||
    (record.gsaContractValues || []).some(Boolean) ||
    /\bGSA\b.*\b(?:holder|schedule|contract|no sales)\b/i.test(text);
  const noSales =
    /\bGSA\b.*\bno sales\b/i.test(text) ||
    (gsaHolderSignal && federalRevenue !== null && federalRevenue <= 0);
  if (
    gsaHolderSignal &&
    (
      explicitNewHolder ||
      (firstGsaAwardDate && sameUtcMonth(firstGsaAwardDate, now))
    )
  ) {
    tags.add("New GSA Holders This Month");
  } else if (gsaHolderSignal && noSales) {
    if (!firstGsaAwardDate) {
      tags.add("GSA No Sales - Tenure Unknown");
    } else {
      const ageDays = Math.max(
        0,
        (now - firstGsaAwardDate) / 86400000
      );
      if (ageDays <= 365) {
        tags.add("GSA No Sales - 1 Year or Less");
      } else if (ageDays <= 730) {
        tags.add("GSA No Sales - 1 to 2 Years");
      } else if (ageDays <= 1095) {
        tags.add("GSA No Sales - 2 to 3 Years");
      } else {
        tags.add("GSA No Sales - 3+ Years");
      }
    }
  }
  const dates = (record.expirationValues || [])
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => a - b);
  const expiration = dates[0] || null;
  if (/\bexpired\b/i.test(text) || (expiration && expiration < now)) {
    tags.add("Expired Everything");
  } else if (
    /expir(?:ing|es?).{0,12}6\s*months?/i.test(text) ||
    (
      expiration &&
      expiration >= now &&
      expiration - now <= 183 * 86400000
    )
  ) {
    tags.add("Expiring 6 Months");
  } else if (
    /expir(?:ing|es?).{0,12}12\s*months?/i.test(text) ||
    (
      expiration &&
      expiration >= now &&
      expiration - now <= 365 * 86400000
    )
  ) {
    tags.add("Expiring 12 Months");
  }
  if (/\bGSA\b|schedule|mas\b/i.test(text)) tags.add("GSA");
  if (/\bVA\b|veterans? affairs|\bFSS\b/i.test(text)) tags.add("VA");
  if (/\bSAM\b/i.test(text)) tags.add("SAM");
  if (
    /\b8\s*\(?a\)?\b|hubzone|wosb|edwosb|sdvosb|vosb|set.?aside|certif/i
      .test(text)
  ) {
    tags.add("Certifications");
  }
  if (/\bSBS\b|small business search/i.test(text)) tags.add("SBS");
  return Array.from(tags);
}

function primarySegment(tags, fallback = "SAM") {
  return SEGMENT_PRECEDENCE.find(segment => tags.includes(segment)) ||
    fallback;
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

function artifactPath(manifest, fileName) {
  const artifact = (manifest.artifacts || []).find(item =>
    path.basename(item.filePath || "") === fileName
  );
  return artifact?.filePath || null;
}

class LegacySegmentReconciliationService {
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
      "legacy_reconciliation"
    );
  }

  safety() {
    return {
      mode: "STAGING_ONLY",
      operationalWritesAllowed: false,
      legacySourceWrites: false,
      legacySourceDeletions: false,
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
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`${label} must remain inside government-data staging.`);
    }
    return resolved;
  }

  completedRuns(parentName, artifactName) {
    const parent = path.join(this.stagingRoot, parentName);
    if (!fs.existsSync(parent)) return [];
    const matches = [];
    for (const entry of fs.readdirSync(parent, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(
        parent,
        entry.name,
        "manifest.json"
      );
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        );
        if (!manifest.ok || manifest.status !== "COMPLETED") continue;
        const filePath = artifactPath(manifest, artifactName);
        if (!filePath || !fs.existsSync(filePath)) continue;
        matches.push({
          generatedAt:
            manifest.completedAt || manifest.generatedAt || "",
          filePath,
          manifestPath
        });
      } catch {}
    }
    return matches.sort((a, b) =>
      b.generatedAt.localeCompare(a.generatedAt)
    );
  }

  findLatestVerifiedPath() {
    const runs = this.completedRuns(
      "email_verification",
      "gsa_freshly_verified_ok.jsonl"
    );
    if (!runs.length) {
      throw new Error(
        "No completed freshly verified company artifact was found."
      );
    }
    return runs[0];
  }

  findLatestVerificationReport() {
    return this.completedRuns(
      "email_verification",
      "millionverifier_all_results.csv"
    )[0]?.filePath || null;
  }

  findLatestAllowlist() {
    const matches = [];
    if (!fs.existsSync(this.stagingRoot)) return null;
    for (const entry of fs.readdirSync(this.stagingRoot, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(
        this.stagingRoot,
        entry.name,
        "gsa_mas_sin_naics_allowlist.json"
      );
      if (fs.existsSync(candidate)) {
        matches.push(candidate);
      }
    }
    matches.sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
    );
    return matches[0] || null;
  }

  findMasterFromInventory() {
    const recoveryRoot = path.join(
      this.stagingRoot,
      "email_recovery"
    );
    if (!fs.existsSync(recoveryRoot)) return null;
    const inventories = [];
    for (const entry of fs.readdirSync(recoveryRoot, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue;
      const inventoryPath = path.join(
        recoveryRoot,
        entry.name,
        "email_source_inventory.json"
      );
      if (fs.existsSync(inventoryPath)) inventories.push(inventoryPath);
    }
    inventories.sort(
      (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
    );
    for (const inventoryPath of inventories) {
      try {
        const inventory = JSON.parse(
          fs.readFileSync(inventoryPath, "utf8")
        );
        const match = (inventory.inventory || []).find(item =>
          /^MASTER_DEDUPED_ALL_SEGMENTS\.csv$/i.test(
            path.basename(item.filePath || "")
          )
        );
        if (match?.filePath && fs.existsSync(match.filePath)) {
          return {
            filePath: match.filePath,
            inventoryPath
          };
        }
      } catch {}
    }
    return null;
  }

  findMasterBySearch() {
    const parent = path.dirname(this.root);
    const roots = [
      path.join(
        parent,
        "Good Files to use",
        "Good To Use and segmented"
      ),
      path.join(parent, "Good Files to use"),
      path.join(this.root, "DATA")
    ].filter(candidate => fs.existsSync(candidate));
    for (const root of roots) {
      const stack = [root];
      while (stack.length) {
        const directory = stack.pop();
        for (const entry of fs.readdirSync(directory, {
          withFileTypes: true
        })) {
          const filePath = path.join(directory, entry.name);
          if (
            entry.isFile() &&
            /^MASTER_DEDUPED_ALL_SEGMENTS\.csv$/i.test(entry.name)
          ) {
            return { filePath, inventoryPath: null };
          }
          if (
            entry.isDirectory() &&
            !/^(?:\.git|node_modules|government_data)$/i.test(entry.name)
          ) {
            stack.push(filePath);
          }
        }
      }
    }
    return null;
  }

  resolveOptions(options = {}) {
    const verified = options.verifiedPath
      ? {
          filePath: this.stagingPath(
            options.verifiedPath,
            "Freshly verified input"
          ),
          manifestPath: null
        }
      : this.findLatestVerifiedPath();
    const master = options.legacyMasterPath
      ? {
          filePath: path.resolve(options.legacyMasterPath),
          inventoryPath: null
        }
      : this.findMasterFromInventory() || this.findMasterBySearch();
    if (!master?.filePath || !fs.existsSync(master.filePath)) {
      throw new Error(
        "MASTER_DEDUPED_ALL_SEGMENTS.csv could not be located."
      );
    }
    const allowlistPath = options.allowlistPath
      ? this.stagingPath(options.allowlistPath, "GSA allowlist")
      : this.findLatestAllowlist();
    if (!allowlistPath || !fs.existsSync(allowlistPath)) {
      throw new Error("The current GSA SIN/NAICS allowlist was not found.");
    }
    const verificationReportPath = options.verificationReportPath
      ? this.stagingPath(
          options.verificationReportPath,
          "Verification report"
        )
      : this.findLatestVerificationReport();
    return {
      verifiedPath: verified.filePath,
      verificationManifestPath: verified.manifestPath,
      legacyMasterPath: master.filePath,
      sourceInventoryPath: master.inventoryPath,
      allowlistPath,
      verificationReportPath,
      outputRoot: this.stagingPath(
        options.outputRoot || this.outputRoot,
        "Output root"
      ),
      runId:
        options.runId ||
        `LEGACY-RECONCILE-${isoNow().replace(/[:.]/g, "-")}`,
      now: options.now ? new Date(options.now) : new Date()
    };
  }

  plan(options = {}) {
    const resolved = this.resolveOptions(options);
    return {
      ok: true,
      mode: "PLAN_ONLY",
      inputs: {
        freshlyVerifiedCompanies: resolved.verifiedPath,
        legacySegmentMaster: resolved.legacyMasterPath,
        currentGsaAllowlist: resolved.allowlistPath,
        verificationReport: resolved.verificationReportPath,
        sourceInventory: resolved.sourceInventoryPath
      },
      reconciliation: {
        identityPrecedence: [
          "UEI",
          "COMPANY_ID",
          "EXACT_LEGAL_NAME",
          "EXACT_EMAIL"
        ],
        primarySegmentPrecedence: SEGMENT_PRECEDENCE,
        rollingGsaHolderSegments: {
          firstPriority: "New GSA Holders This Month",
          definition:
            "First GSA award is in the pull month or the holder is absent " +
            "from the prior authoritative GSA-holder snapshot.",
          samRegistrationDateIsNotGsaAwardDate: true,
          noSalesTenureBands: [
            "1 Year or Less",
            "1 to 2 Years",
            "2 to 3 Years",
            "3+ Years"
          ],
          missingTenureEvidenceFailsClosed: true
        },
        everyLegacyRowAccountedFor: true,
        qualifiedUnmatchedLeadsPreservedForEnrichment: true,
        onlyFreshlyVerifiedEmailsOutboundReady: true,
        deletionPlanOnly: true
      },
      outputRoot: resolved.outputRoot,
      safety: this.safety()
    };
  }

  loadAllowlist(filePath) {
    const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const allowedNaics = new Set(
      (source.uniqueNaics || []).map(String).filter(Boolean)
    );
    if (!allowedNaics.size) {
      throw new Error("The GSA allowlist contains no NAICS codes.");
    }
    return allowedNaics;
  }

  async loadVerificationResults(filePath) {
    const results = new Map();
    if (!filePath || !fs.existsSync(filePath)) return results;
    const input = fs.createReadStream(filePath, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let headers = null;
    let emailIndex = -1;
    let resultIndex = -1;
    for await (const line of lines) {
      if (!headers) {
        headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
        emailIndex = headers.findIndex(header =>
          normalizeHeader(header) === "email"
        );
        resultIndex = headers.findIndex(header =>
          ["result", "status"].includes(normalizeHeader(header))
        );
        continue;
      }
      const fields = parseCsvLine(line);
      const email = normalizeEmail(fields[emailIndex]);
      if (email) {
        results.set(
          email,
          String(fields[resultIndex] || "unknown").trim().toUpperCase()
        );
      }
    }
    return results;
  }

  async loadFreshCompanies(filePath) {
    const companies = [];
    const indexes = {
      uei: new Map(),
      companyId: new Map(),
      name: new Map(),
      email: new Map()
    };
    const input = fs.createReadStream(filePath, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const company = JSON.parse(line);
      const index = companies.length;
      company.__reconciliation = {
        legacyRows: [],
        segmentTags: new Set(["SAM"])
      };
      companies.push(company);
      const values = {
        uei: normalizeText(company.uei),
        companyId: normalizeText(
          company.companyId || company.company_id
        ),
        name: normalizeText(
          company.legalBusinessName ||
            company.legalName ||
            company.company
        )
      };
      for (const [type, value] of Object.entries(values)) {
        if (value && !indexes[type].has(value)) {
          indexes[type].set(value, index);
        }
      }
      for (const contact of company.recoveredEmailMatch?.emails || []) {
        const email = normalizeEmail(contact.email);
        if (email && !indexes.email.has(email)) {
          indexes.email.set(email, index);
        }
      }
    }
    return { companies, indexes };
  }

  matchFresh(record, indexes) {
    for (const [type, values] of [
      ["uei", [record.uei]],
      ["companyId", [record.companyId]],
      ["name", record.companyValues],
      ["email", record.emails]
    ]) {
      for (const rawValue of values || []) {
        const value = type === "email"
          ? normalizeEmail(rawValue)
          : normalizeText(rawValue);
        if (value && indexes[type].has(value)) {
          return {
            companyIndex: indexes[type].get(value),
            matchedBy: type === "companyId"
              ? "COMPANY_ID"
              : type.toUpperCase()
          };
        }
      }
    }
    return null;
  }

  classifyLegacy(record, context) {
    const {
      allowedNaics,
      verificationResults,
      freshMatch,
      seenFreshCompanies
    } = context;
    const hasIdentity = Boolean(
      normalizeText(record.uei) ||
      normalizeText(record.companyId) ||
      record.companyValues.some(normalizeText) ||
      record.emails.some(normalizeEmail)
    );
    const allowedMatches = record.naicsCodes.filter(naics =>
      allowedNaics.has(naics)
    );
    const segmentSignal = record.segmentTags.length > 0;
    const companyText = record.companyValues.join(" ");
    const blockedEntity = BLOCKED_ENTITY_WORDS.some(pattern =>
      pattern.test(companyText)
    );
    const manufacturing = record.naicsCodes.some(naics =>
      /^(31|32|33)/.test(naics)
    );
    const dispositions = record.emails.map(email => ({
      email: normalizeEmail(email) || email,
      disposition: emailDisposition(email, verificationResults)
    }));

    if (freshMatch) {
      const duplicate = seenFreshCompanies.has(freshMatch.companyIndex);
      seenFreshCompanies.add(freshMatch.companyIndex);
      return {
        category: duplicate
          ? "OLDER_DUPLICATE_OF_RETAINED"
          : "RETAINED_FRESH_VERIFIED",
        eligibleForEnrichment: false,
        candidateForDeletionAfterApproval: duplicate,
        matchedFreshCompanyIndex: freshMatch.companyIndex,
        matchedBy: freshMatch.matchedBy,
        allowedNaicsMatches: allowedMatches,
        emailDispositions: dispositions
      };
    }
    if (!hasIdentity) {
      return {
        category: "IDENTITY_UNRESOLVED",
        eligibleForEnrichment: true,
        candidateForDeletionAfterApproval: false,
        matchedFreshCompanyIndex: null,
        matchedBy: null,
        allowedNaicsMatches: allowedMatches,
        emailDispositions: dispositions
      };
    }
    if (blockedEntity || manufacturing) {
      return {
        category: "DISALLOWED_ENTITY_OR_MANUFACTURING",
        eligibleForEnrichment: false,
        candidateForDeletionAfterApproval: false,
        matchedFreshCompanyIndex: null,
        matchedBy: null,
        allowedNaicsMatches: allowedMatches,
        emailDispositions: dispositions
      };
    }
    if (allowedMatches.length) {
      return {
        category: "QUALIFIED_NEEDS_VERIFIED_EMAIL",
        eligibleForEnrichment: true,
        candidateForDeletionAfterApproval: false,
        matchedFreshCompanyIndex: null,
        matchedBy: null,
        allowedNaicsMatches: allowedMatches,
        emailDispositions: dispositions
      };
    }
    if (segmentSignal) {
      return {
        category: "LEGACY_ELIGIBILITY_REVIEW",
        eligibleForEnrichment: true,
        candidateForDeletionAfterApproval: false,
        matchedFreshCompanyIndex: null,
        matchedBy: null,
        allowedNaicsMatches: [],
        emailDispositions: dispositions
      };
    }
    return {
      category: "NO_CURRENT_GSA_MATCH",
      eligibleForEnrichment: false,
      candidateForDeletionAfterApproval: false,
      matchedFreshCompanyIndex: null,
      matchedBy: null,
      allowedNaicsMatches: [],
      emailDispositions: dispositions
    };
  }

  async reconcile(options = {}) {
    const resolved = this.resolveOptions(options);
    const allowedNaics = this.loadAllowlist(resolved.allowlistPath);
    const verificationResults = await this.loadVerificationResults(
      resolved.verificationReportPath
    );
    const fresh = await this.loadFreshCompanies(resolved.verifiedPath);
    const runRoot = this.stagingPath(
      path.join(resolved.outputRoot, resolved.runId),
      "Run output"
    );
    if (fs.existsSync(runRoot)) {
      throw new Error(`Run output already exists: ${runRoot}`);
    }
    fs.mkdirSync(runRoot, { recursive: true });
    const files = {
      ledger: path.join(runRoot, "legacy_reconciliation_ledger.jsonl"),
      enrichment: path.join(
        runRoot,
        "legacy_qualified_enrichment_queue.jsonl"
      ),
      master: path.join(
        runRoot,
        "refreshed_verified_segment_master.jsonl"
      ),
      tenureGap: path.join(
        runRoot,
        "gsa_holder_tenure_evidence_gap.jsonl"
      ),
      segmentReport: path.join(runRoot, "segment_count_report.csv"),
      deletionPlan: path.join(
        runRoot,
        "legacy_deletion_replacement_plan.json"
      )
    };
    const partials = Object.fromEntries(
      ["ledger", "enrichment", "master", "tenureGap"].map(key => [
        key,
        `${files[key]}.partial`
      ])
    );
    const writers = Object.fromEntries(
      Object.entries(partials).map(([key, filePath]) => [
        key,
        fs.createWriteStream(filePath, {
          encoding: "utf8",
          flags: "wx"
        })
      ])
    );
    const counts = {
      legacyRowsProcessed: 0,
      refreshedVerifiedCompanies: fresh.companies.length,
      categories: {},
      enrichmentQueueRows: 0,
      deletionCandidatesAfterApproval: 0,
      gsaHolderTenureEvidenceGaps: 0,
      malformedRows: 0
    };
    const originalSegments = new Map();
    const seenFreshCompanies = new Set();

    try {
      const input = fs.createReadStream(resolved.legacyMasterPath, {
        encoding: "utf8"
      });
      const lines = readline.createInterface({
        input,
        crlfDelay: Infinity
      });
      let headers = null;
      let indexes = null;
      let sourceLine = 0;
      for await (const line of lines) {
        sourceLine += 1;
        if (!headers) {
          headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
          indexes = {
            email: indexesFor(headers, EMAIL_HEADERS),
            uei: indexesFor(headers, UEI_HEADERS),
            companyId: indexesFor(headers, COMPANY_ID_HEADERS),
            company: indexesFor(headers, COMPANY_HEADERS),
            naics: indexesFor(headers, NAICS_HEADERS),
            segment: indexesFor(headers, SEGMENT_HEADERS),
            expiration: indexesFor(headers, EXPIRATION_HEADERS),
            gsaStart: indexesFor(headers, GSA_START_HEADERS),
            revenue: indexesFor(headers, REVENUE_HEADERS),
            gsaContract: indexesFor(
              headers,
              GSA_CONTRACT_HEADERS
            ),
            certification: headers
              .map((header, index) =>
                /certification|8\(a\)|hubzone|wosb|vosb/i.test(header)
                  ? index
                  : -1
              )
              .filter(index => index >= 0)
          };
          continue;
        }
        if (!line.trim()) continue;
        counts.legacyRowsProcessed += 1;
        let fields;
        try {
          fields = parseCsvLine(line);
        } catch (error) {
          counts.malformedRows += 1;
          throw new Error(
            `Malformed legacy CSV row ${sourceLine}: ${error.message}`
          );
        }
        const record = {
          sourceLine,
          uei: firstAt(fields, indexes.uei),
          companyId: firstAt(fields, indexes.companyId),
          companyValues: valuesAt(fields, indexes.company),
          emails: valuesAt(fields, indexes.email),
          naicsCodes: extractNaics(valuesAt(fields, indexes.naics)),
          segmentValues: valuesAt(fields, indexes.segment),
          expirationValues: valuesAt(fields, indexes.expiration),
          gsaStartValues: valuesAt(fields, indexes.gsaStart),
          revenueValues: valuesAt(fields, indexes.revenue),
          gsaContractValues: valuesAt(
            fields,
            indexes.gsaContract
          ),
          certificationValues: valuesAt(
            fields,
            indexes.certification
          )
        };
        record.legalBusinessName = record.companyValues[0] || null;
        record.segmentTags = segmentTags(record, resolved.now);
        record.primarySegment = primarySegment(
          record.segmentTags,
          "Unclassified Legacy"
        );
        originalSegments.set(
          record.primarySegment,
          (originalSegments.get(record.primarySegment) || 0) + 1
        );
        const freshMatch = this.matchFresh(record, fresh.indexes);
        const classification = this.classifyLegacy(record, {
          allowedNaics,
          verificationResults,
          freshMatch,
          seenFreshCompanies
        });
        counts.categories[classification.category] =
          (counts.categories[classification.category] || 0) + 1;
        if (classification.candidateForDeletionAfterApproval) {
          counts.deletionCandidatesAfterApproval += 1;
        }
        if (classification.matchedFreshCompanyIndex !== null) {
          const company =
            fresh.companies[classification.matchedFreshCompanyIndex];
          company.__reconciliation.legacyRows.push(sourceLine);
          for (const tag of record.segmentTags) {
            company.__reconciliation.segmentTags.add(tag);
          }
        }
        const ledgerRecord = {
          legacySourceLine: sourceLine,
          legacyIdentity: {
            uei: record.uei || null,
            companyId: record.companyId || null,
            legalBusinessName: record.legalBusinessName,
            emails: record.emails
          },
          legacySegmentation: {
            primarySegment: record.primarySegment,
            segmentTags: record.segmentTags,
            naicsCodes: record.naicsCodes
          },
          ...classification,
          matchedFreshCompanyIndex: undefined
        };
        await writeJsonLine(writers.ledger, ledgerRecord);
        if (classification.eligibleForEnrichment) {
          counts.enrichmentQueueRows += 1;
          await writeJsonLine(writers.enrichment, ledgerRecord);
        }
      }

      const refreshedSegments = new Map();
      for (const company of fresh.companies) {
        const reconciliation = company.__reconciliation;
        const tags = Array.from(reconciliation.segmentTags);
        const segment = primarySegment(tags, "SAM");
        const tenureEvidenceMissing =
          tags.includes("GSA No Sales - Tenure Unknown");
        refreshedSegments.set(
          segment,
          (refreshedSegments.get(segment) || 0) + 1
        );
        const contacts = (
          company.recoveredEmailMatch?.emails || []
        ).filter(contact =>
          contact.freshVerification?.result === "ok"
        );
        if (!contacts.length) {
          throw new Error(
            `Fresh company ${company.uei || company.legalBusinessName} ` +
            "has no MillionVerifier OK email."
          );
        }
        const clean = { ...company };
        delete clean.__reconciliation;
        if (tenureEvidenceMissing) {
          counts.gsaHolderTenureEvidenceGaps += 1;
          await writeJsonLine(writers.tenureGap, {
            uei: company.uei || null,
            legalBusinessName:
              company.legalBusinessName || null,
            inheritedLegacyRows: reconciliation.legacyRows,
            reason:
              "GSA_HOLDER_START_OR_FIRST_AWARD_DATE_REQUIRED",
            prohibitedSubstitute:
              "SAM_REGISTRATION_DATE_MUST_NOT_BE_USED",
            nextSource:
              "CURRENT_AND_PRIOR_GSA_ELIBRARY_HOLDER_SNAPSHOTS"
          });
        }
        await writeJsonLine(writers.master, {
          ...clean,
          segmentation: {
            primarySegment: segment,
            secondarySegments: tags.filter(tag => tag !== segment),
            precedence: SEGMENT_PRECEDENCE,
            inheritedLegacyRows: reconciliation.legacyRows,
            onePrimarySegment: true,
            priorityRank:
              SEGMENT_PRECEDENCE.indexOf(segment) + 1,
            gsaHolderTenureEvidenceComplete:
              !tenureEvidenceMissing
          },
          outboundReadiness: {
            stagingOnly: true,
            freshlyVerifiedEmailRequired: true,
            freshlyVerifiedEmailPresent: true,
            operationalImportApproved: false
          }
        });
      }
      await Promise.all(Object.values(writers).map(finishWriter));
      for (const key of Object.keys(partials)) {
        fs.renameSync(partials[key], files[key]);
      }

      const allSegments = Array.from(
        new Set([
          ...SEGMENT_PRECEDENCE,
          ...originalSegments.keys(),
          ...refreshedSegments.keys()
        ])
      );
      const segmentCsv = [
        [
          "Segment",
          "LegacyRows",
          "RefreshedVerifiedCompanies",
          "Difference"
        ].map(csvCell).join(",")
      ];
      for (const segment of allSegments) {
        const legacy = originalSegments.get(segment) || 0;
        const refreshed = refreshedSegments.get(segment) || 0;
        segmentCsv.push(
          [
            segment,
            legacy,
            refreshed,
            refreshed - legacy
          ].map(csvCell).join(",")
        );
      }
      fs.writeFileSync(
        files.segmentReport,
        `${segmentCsv.join("\n")}\n`,
        "utf8"
      );
      const deletionPlan = {
        generatedAt: isoNow(),
        mode: "PLAN_ONLY",
        legacyMaster: resolved.legacyMasterPath,
        legacyRowsAccountedFor: counts.legacyRowsProcessed,
        replacementMaster: files.master,
        replacementCompanies: fresh.companies.length,
        candidateRows: counts.deletionCandidatesAfterApproval,
        candidateCategory: "OLDER_DUPLICATE_OF_RETAINED",
        unmatchedQualifiedRowsPreserved:
          counts.enrichmentQueueRows,
        deletionAuthorized: false,
        safeToDeleteNow: false,
        prerequisites: [
          "review reconciliation ledger",
          "review segment count report",
          "back up the legacy master",
          "approve the refreshed operational import",
          "verify imported row and email counts",
          "issue a separate controlled-write deletion approval"
        ]
      };
      fs.writeFileSync(
        files.deletionPlan,
        JSON.stringify(deletionPlan, null, 2),
        "utf8"
      );
    } catch (error) {
      for (const writer of Object.values(writers)) {
        if (!writer.destroyed) writer.destroy();
      }
      fs.writeFileSync(
        path.join(runRoot, "failure.json"),
        JSON.stringify({
          ok: false,
          status: "FAILED",
          failedAt: isoNow(),
          error: error.message,
          safety: this.safety()
        }, null, 2),
        "utf8"
      );
      throw error;
    }

    if (
      Object.values(counts.categories)
        .reduce((sum, value) => sum + value, 0) !==
      counts.legacyRowsProcessed
    ) {
      throw new Error("Legacy row conservation check failed.");
    }
    const artifacts = Object.values(files).map(filePath => ({
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
        freshlyVerifiedCompanies: resolved.verifiedPath,
        freshlyVerifiedSha256: sha256(resolved.verifiedPath),
        legacySegmentMaster: resolved.legacyMasterPath,
        legacySegmentMasterSha256: sha256(
          resolved.legacyMasterPath
        ),
        currentGsaAllowlist: resolved.allowlistPath,
        currentGsaAllowlistSha256: sha256(
          resolved.allowlistPath
        ),
        verificationReport: resolved.verificationReportPath,
        sourceInventory: resolved.sourceInventoryPath
      },
      counts,
      conservation: {
        everyLegacyRowClassified: true,
        classifiedRows: Object.values(counts.categories)
          .reduce((sum, value) => sum + value, 0),
        sourceRows: counts.legacyRowsProcessed,
        qualifiedUnmatchedRowsPreserved:
          counts.enrichmentQueueRows
      },
      segmentation: {
        onePrimarySegmentPerRefreshedCompany: true,
        precedence: SEGMENT_PRECEDENCE,
        rollingNewGsaHolderSegment: true,
        newHolderCycle: "CALENDAR_MONTH_OF_PULL",
        samRegistrationDateUsedAsGsaAwardDate: false,
        gsaHolderTenureEvidenceGaps:
          counts.gsaHolderTenureEvidenceGaps
      },
      artifacts,
      nextGate: {
        reviewRequired: true,
        operationalImportApprovalRequired: true,
        deletionApprovalRequiredSeparately: true,
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

LegacySegmentReconciliationService.SEGMENT_PRECEDENCE =
  SEGMENT_PRECEDENCE;
LegacySegmentReconciliationService.parseCsvLine = parseCsvLine;
LegacySegmentReconciliationService.segmentTags = segmentTags;

module.exports = LegacySegmentReconciliationService;
