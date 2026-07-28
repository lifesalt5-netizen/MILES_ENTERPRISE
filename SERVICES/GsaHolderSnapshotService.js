"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { once } = require("events");

const ELIBRARY_MAS_CSV =
  "https://gsaelibrary.gsa.gov/elib_contracts/schedule_MAS.csv";
const SAM_AWARDS_API =
  "https://api.sam.gov/contract-awards/v1/search";

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

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex").toUpperCase();
}

function monthBounds(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid pull month.");
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const format = item =>
    `${String(item.getUTCMonth() + 1).padStart(2, "0")}/` +
    `${String(item.getUTCDate()).padStart(2, "0")}/` +
    item.getUTCFullYear();
  return {
    cycle: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: format(start),
    end: format(end)
  };
}

function dateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

function formatIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

function addUtcYears(value, years) {
  const result = new Date(value.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function dayBefore(value) {
  return new Date(value.getTime() - 86400000);
}

function completedCalendarYears(start, asOf) {
  let years = asOf.getUTCFullYear() - start.getUTCFullYear();
  const anniversary = addUtcYears(start, years);
  if (asOf < anniversary) years -= 1;
  return years;
}

function gsaContractTerm(firstAwardDate, asOfDate = new Date()) {
  const start = dateOnly(firstAwardDate);
  const asOf = dateOnly(asOfDate);
  if (!start) {
    return {
      evidenceStatus: "AWAITING_FIRST_GSA_AWARD_DATE",
      termNumber: null,
      termLabel: null,
      overallContractYear: null,
      yearWithinTerm: null,
      termStartDate: null,
      termEndDate: null,
      totalPotentialYears: 20
    };
  }
  if (!asOf || start > asOf) {
    return {
      evidenceStatus: "AWARD_DATE_REVIEW_REQUIRED",
      termNumber: null,
      termLabel: null,
      overallContractYear: null,
      yearWithinTerm: null,
      termStartDate: null,
      termEndDate: null,
      totalPotentialYears: 20
    };
  }
  const completedYears = completedCalendarYears(start, asOf);
  if (completedYears >= 20) {
    return {
      evidenceStatus: "BEYOND_20_YEAR_MAXIMUM_REVIEW_REQUIRED",
      termNumber: null,
      termLabel: null,
      overallContractYear: completedYears + 1,
      yearWithinTerm: null,
      termStartDate: null,
      termEndDate: null,
      totalPotentialYears: 20
    };
  }
  const termNumber = Math.floor(completedYears / 5) + 1;
  const termLabels = {
    1: "TERM_1_BASE",
    2: "TERM_2_OPTION",
    3: "TERM_3_OPTION",
    4: "TERM_4_FINAL"
  };
  const termStart = addUtcYears(start, (termNumber - 1) * 5);
  const termEnd = dayBefore(addUtcYears(start, termNumber * 5));
  return {
    evidenceStatus: "CONFIRMED",
    termNumber,
    termLabel: termLabels[termNumber],
    overallContractYear: completedYears + 1,
    yearWithinTerm: (completedYears % 5) + 1,
    termStartDate: formatIsoDate(termStart),
    termEndDate: formatIsoDate(termEnd),
    totalPotentialYears: 20
  };
}

function isDateInCycle(value, cycle) {
  const date = dateOnly(value);
  return Boolean(date) && formatIsoDate(date).startsWith(`${cycle}-`);
}

function valueByHeader(fields, indexes, names) {
  for (const name of names) {
    const index = indexes.get(normalizeHeader(name));
    const value = index === undefined
      ? ""
      : String(fields[index] || "").trim();
    if (value) return value;
  }
  return "";
}

function awardRecord(value) {
  const contractId = value.contractId || {};
  const details = value.awardDetails || {};
  const awardee = details.awardeeData || value.awardeeData || {};
  const ueiInfo =
    awardee.awardeeUEIInformation ||
    details.awardeeUEIInformation ||
    {};
  const header =
    awardee.awardeeHeader ||
    details.awardeeHeader ||
    {};
  const dates = details.dates || {};
  return {
    contractNumber:
      contractId.piid ||
      details.contractData?.piid ||
      null,
    modificationNumber:
      contractId.modificationNumber || null,
    uei:
      ueiInfo.uniqueEntityId ||
      ueiInfo.ueiSAM ||
      null,
    legalBusinessName:
      header.awardeeNameFromContract ||
      header.awardeeName ||
      null,
    firstGsaAwardDate:
      dates.dateSigned ||
      dates.periodOfPerformanceStartDate ||
      null,
    currentCompletionDate:
      dates.currentCompletionDate || null,
    ultimateCompletionDate:
      dates.ultimateCompletionDate || null
  };
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

class GsaHolderSnapshotService {
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
      "gsa_holder_snapshot"
    );
    this.fetch = options.fetch || globalThis.fetch;
    this.eLibraryUrl =
      options.eLibraryUrl || ELIBRARY_MAS_CSV;
    this.samAwardsUrl =
      options.samAwardsUrl || SAM_AWARDS_API;
    this.timeoutMs = Number(options.timeoutMs || 300000);
  }

  safety(externalReads = false) {
    return {
      mode: "STAGING_ONLY",
      officialSourceReads: externalReads,
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
      throw new Error(`${label} must remain inside staging.`);
    }
    return resolved;
  }

  resolveOptions(options = {}) {
    const bounds = monthBounds(options.pullMonth || new Date());
    const outputRoot = this.stagingPath(
      options.outputRoot || this.outputRoot,
      "Output root"
    );
    return {
      ...bounds,
      outputRoot,
      runId:
        options.runId ||
        `GSA-HOLDERS-${bounds.cycle}-${isoNow()
          .replace(/[:.]/g, "-")}`,
      apiKey: String(options.apiKey || "").trim()
    };
  }

  plan(options = {}) {
    const resolved = this.resolveOptions(options);
    return {
      ok: true,
      mode: "PLAN_ONLY",
      pullCycle: resolved.cycle,
      sources: [
        {
          authority: "GSA eLibrary",
          url: this.eLibraryUrl,
          purpose: "current MAS holder roster"
        },
        {
          authority: "SAM.gov Contract Awards",
          url: this.samAwardsUrl,
          purpose:
            "base Federal Supply Schedule awards signed in pull month",
          dateSigned: `[${resolved.start},${resolved.end}]`
        }
      ],
      rules: {
        currentHolderMustAppearInElibrary: true,
        newHolderMustHaveBaseFssAwardInPullMonth: true,
        samRegistrationDateProhibitedAsAwardDate: true,
        eLibraryEmailsAreNotFreshlyVerified: true,
        contractTerms: [
          "TERM_1_BASE",
          "TERM_2_OPTION",
          "TERM_3_OPTION",
          "TERM_4_FINAL"
        ],
        totalPotentialContractYears: 20,
        missingFirstAwardDateFailsClosed: true
      },
      apiKeyConfigured: Boolean(resolved.apiKey),
      outputRoot: resolved.outputRoot,
      safety: this.safety(false)
    };
  }

  async requestText(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        "User-Agent": "MILES-Government-Data-Staging/1.0",
        Accept: "text/csv,application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Official source returned HTTP ${response.status}.`
      );
    }
    return {
      text,
      contentType: response.headers?.get?.("content-type") || null,
      sourceDate: response.headers?.get?.("last-modified") || null
    };
  }

  parseELibrary(csvText) {
    const lines = String(csvText || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error("GSA eLibrary returned no contractor rows.");
    }
    const headers = parseCsvLine(lines[0]);
    const indexes = new Map(
      headers.map((header, index) => [
        normalizeHeader(header),
        index
      ])
    );
    for (const required of ["Vendor", "Cont#", "SAM UEI"]) {
      if (!indexes.has(normalizeHeader(required))) {
        throw new Error(
          `GSA eLibrary CSV is missing ${required}.`
        );
      }
    }
    const contracts = new Map();
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const fields = parseCsvLine(lines[lineIndex]);
      const contractNumber = valueByHeader(
        fields,
        indexes,
        ["Cont#", "Contract Number"]
      );
      if (!contractNumber) continue;
      const key = normalizeText(contractNumber);
      const category = valueByHeader(
        fields,
        indexes,
        ["Cat", "Category"]
      );
      const existing = contracts.get(key);
      if (existing) {
        if (category && !existing.categories.includes(category)) {
          existing.categories.push(category);
        }
        continue;
      }
      const email = valueByHeader(fields, indexes, ["Email"]);
      contracts.set(key, {
        authority: "GSA eLibrary",
        sourceUrl: this.eLibraryUrl,
        contractNumber,
        legalBusinessName: valueByHeader(
          fields,
          indexes,
          ["Vendor"]
        ) || null,
        uei: valueByHeader(
          fields,
          indexes,
          ["SAM UEI", "UEI"]
        ) || null,
        closedForNewAwards:
          valueByHeader(
            fields,
            indexes,
            ["Closed for New Award"]
          ) || null,
        city: valueByHeader(fields, indexes, ["City"]) || null,
        state: valueByHeader(fields, indexes, ["State"]) || null,
        phone: valueByHeader(fields, indexes, ["Phone"]) || null,
        sourceEmail: email || null,
        sourceEmailFreshlyVerified: false,
        website: valueByHeader(fields, indexes, ["URL"]) || null,
        currentOptionPeriodEndDate:
          valueByHeader(
            fields,
            indexes,
            ["Current Option Period End Date"]
          ) || null,
        ultimateContractEndDate:
          valueByHeader(
            fields,
            indexes,
            [
              "Ultimate Cont End Date",
              "Ultimate End Date"
            ]
          ) || null,
        socioEconomicIndicators:
          valueByHeader(
            fields,
            indexes,
            ["Socio-Economic Indicators"]
          ) || null,
        categories: category ? [category] : []
      });
    }
    return {
      sourceRows: lines.length - 1,
      contracts: Array.from(contracts.values())
    };
  }

  async loadMonthlyAwards(apiKey, resolved) {
    if (!apiKey) {
      throw new Error("SAM_API_KEY is required.");
    }
    const awards = [];
    let offset = 0;
    const limit = 100;
    let totalRecords = null;
    do {
      const url = new URL(this.samAwardsUrl);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("awardOrIDV", "IDV");
      url.searchParams.set(
        "awardOrIDVTypeName",
        "FEDERAL SUPPLY SCHEDULE"
      );
      url.searchParams.set("contractingDepartmentCode", "4700");
      url.searchParams.set("modificationNumber", "0");
      url.searchParams.set(
        "dateSigned",
        `[${resolved.start},${resolved.end}]`
      );
      url.searchParams.set(
        "includeSections",
        "contractId,awardDetails,awardeeData"
      );
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      const response = await this.requestText(url.toString(), {
        headers: { Accept: "application/json" }
      });
      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        throw new Error(
          "SAM Contract Awards returned invalid JSON."
        );
      }
      const page = payload.awardSummary || [];
      totalRecords = Number(payload.totalRecords || page.length);
      awards.push(...page.map(awardRecord));
      offset += limit;
      if (!page.length) break;
    } while (offset < totalRecords);
    return { awards, totalRecords };
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
    const rawELibraryPath = path.join(
      runRoot,
      "gsa_elibrary_schedule_MAS.csv"
    );
    const holdersPath = path.join(
      runRoot,
      "gsa_current_mas_holders.jsonl"
    );
    const newHoldersPath = path.join(
      runRoot,
      "gsa_new_holders_current_month.jsonl"
    );
    try {
      const eLibrary = await this.requestText(this.eLibraryUrl);
      fs.writeFileSync(rawELibraryPath, eLibrary.text, "utf8");
      const parsed = this.parseELibrary(eLibrary.text);
      const monthly = await this.loadMonthlyAwards(
        resolved.apiKey,
        resolved
      );
      const holdersByContract = new Map(
        parsed.contracts.map(holder => [
          normalizeText(holder.contractNumber),
          holder
        ])
      );
      const holdersByUei = new Map(
        parsed.contracts
          .filter(holder => holder.uei)
          .map(holder => [normalizeText(holder.uei), holder])
      );
      const holdersWriter = fs.createWriteStream(holdersPath, {
        encoding: "utf8",
        flags: "wx"
      });
      const newWriter = fs.createWriteStream(newHoldersPath, {
        encoding: "utf8",
        flags: "wx"
      });
      const newHolderKeys = new Set();
      const newHolderByKey = new Map();
      for (const award of monthly.awards) {
        const holder =
          holdersByContract.get(normalizeText(award.contractNumber)) ||
          holdersByUei.get(normalizeText(award.uei));
        if (!holder) continue;
        const key =
          normalizeText(holder.contractNumber) ||
          normalizeText(holder.uei);
        if (!key || newHolderKeys.has(key)) continue;
        if (
          !award.firstGsaAwardDate ||
          !isDateInCycle(award.firstGsaAwardDate, resolved.cycle)
        ) {
          continue;
        }
        newHolderKeys.add(key);
        const contractTerm = gsaContractTerm(
          award.firstGsaAwardDate,
          `${resolved.cycle}-28`
        );
        const newHolder = {
          ...holder,
          firstGsaAwardDate: award.firstGsaAwardDate,
          contractTerm,
          samAwardEvidence: award,
          segment: "New GSA Holders This Month",
          segmentPriority: 1,
          pullCycle: resolved.cycle,
          realVerifiedEmailRequired: true,
          eLibraryEmailAcceptedWithoutVerification: false,
          operationallyEligible: false
        };
        newHolderByKey.set(key, newHolder);
        await writeJsonLine(newWriter, newHolder);
      }
      for (const holder of parsed.contracts) {
        const key =
          normalizeText(holder.contractNumber) ||
          normalizeText(holder.uei);
        const newHolder = newHolderByKey.get(key);
        await writeJsonLine(holdersWriter, {
          ...holder,
          firstGsaAwardDate:
            newHolder?.firstGsaAwardDate || null,
          contractTerm:
            newHolder?.contractTerm || gsaContractTerm(null),
          snapshotCycle: resolved.cycle,
          retrievedAt: isoNow()
        });
      }
      await Promise.all([
        finishWriter(holdersWriter),
        finishWriter(newWriter)
      ]);
      const artifacts = [
        rawELibraryPath,
        holdersPath,
        newHoldersPath
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
        pullCycle: resolved.cycle,
        inputs: {
          eLibraryUrl: this.eLibraryUrl,
          samAwardsEndpoint: this.samAwardsUrl,
          samQuery: {
            awardOrIDV: "IDV",
            awardOrIDVTypeName: "FEDERAL SUPPLY SCHEDULE",
            contractingDepartmentCode: "4700",
            modificationNumber: "0",
            dateSigned: `[${resolved.start},${resolved.end}]`
          },
          apiKeyPersisted: false
        },
        counts: {
          eLibraryRows: parsed.sourceRows,
          currentMasContracts: parsed.contracts.length,
          monthlyBaseFssAwardsReturned: monthly.awards.length,
          monthlyBaseFssAwardsReported:
            monthly.totalRecords,
          newCurrentMasHolders: newHolderByKey.size,
          currentHoldersAwaitingFirstAwardDate:
            parsed.contracts.length - newHolderByKey.size
        },
        rules: {
          currentHolderConfirmedByELibrary: true,
          firstAwardDateConfirmedBySAMContractAwards: true,
          samRegistrationDateUsedAsAwardDate: false,
          sourceEmailsNeedFreshVerification: true,
          contractTermYears: 5,
          contractTermCount: 4,
          maximumContractYears: 20,
          termEvidenceFailsClosed: true
        },
        artifacts,
        nextGate: {
          matchToFreshlyVerifiedMaster: true,
          unmatchedNewHoldersToEmailEnrichment: true,
          ssqSalesRequiredForNoSalesTenureBands: true,
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
          error: resolved.apiKey
            ? String(error.message || error)
              .split(resolved.apiKey).join("[REDACTED]")
            : String(error.message || error),
          safety: this.safety(true)
        }, null, 2),
        "utf8"
      );
      throw error;
    }
  }
}

GsaHolderSnapshotService.monthBounds = monthBounds;
GsaHolderSnapshotService.parseCsvLine = parseCsvLine;
GsaHolderSnapshotService.gsaContractTerm = gsaContractTerm;
GsaHolderSnapshotService.ELIBRARY_MAS_CSV = ELIBRARY_MAS_CSV;

module.exports = GsaHolderSnapshotService;
