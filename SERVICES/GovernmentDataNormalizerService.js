"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = process.env.MILES_ROOT || process.cwd();
const DEFAULT_CONTRACT_PATH = path.join(
  ROOT,
  "CONFIG",
  "GOVERNMENT_DATA",
  "sam_public_v2_required_fields.json"
);
const DEFAULT_STAGING_ROOT = path.join(
  ROOT,
  "DATA",
  "staging",
  "government_data"
);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function compactDate(value) {
  const normalized = text(value);
  if (!/^\d{8}$/.test(normalized)) return null;
  return [
    normalized.slice(0, 4),
    normalized.slice(4, 6),
    normalized.slice(6, 8)
  ].join("-");
}

function splitTilde(value) {
  return text(value)
    .split("~")
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeWebsite(value) {
  const raw = text(value);
  if (!raw) {
    return {
      website: null,
      websiteDomain: null
    };
  }

  let hostname = raw.toLowerCase();
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    );
    hostname = parsed.hostname.toLowerCase();
  } catch {
    hostname = hostname
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0];
  }

  hostname = hostname.replace(/^www\./, "");
  return {
    website: raw,
    websiteDomain: hostname || null
  };
}

function parseNaics(value, primaryNaics) {
  const codes = new Set();
  const primary = text(primaryNaics).match(/^\d{6}$/)
    ? text(primaryNaics)
    : null;

  if (primary) codes.add(primary);
  for (const item of splitTilde(value)) {
    const match = item.match(/^(\d{6})/);
    if (match) codes.add(match[1]);
  }

  return {
    primaryNaics: primary,
    naicsCodes: Array.from(codes)
  };
}

function reasonCodes(record, contract) {
  const rules = contract.recordRules;
  const reasons = [];

  if (!rules.allowedExtractCodes.includes(record.samExtractCode)) {
    reasons.push("SAM_RECORD_NOT_ACTIVE");
  }
  if (
    !rules.allowedRegistrationPurposes.includes(
      record.purposeOfRegistration
    )
  ) {
    reasons.push("NOT_REGISTERED_FOR_ALL_AWARDS");
  }
  if (
    !rules.allowedForProfitEntityStructures.includes(
      record.entityStructure
    )
  ) {
    reasons.push("FOR_PROFIT_ENTITY_STRUCTURE_NOT_CONFIRMED");
  }
  if (
    record.exclusionStatusFlag === rules.blockedExclusionFlag
  ) {
    reasons.push("ACTIVE_SAM_EXCLUSION");
  }
  if (
    record.noPublicDisplayFlag === rules.blockedNoPublicDisplayFlag
  ) {
    reasons.push("PUBLIC_DISPLAY_NOT_AUTHORIZED");
  }

  const manufacturing = record.naicsCodes.filter(code =>
    rules.blockedManufacturingNaicsPrefixes.some(prefix =>
      code.startsWith(prefix)
    )
  );
  if (manufacturing.length > 0) {
    reasons.push("EXCLUDED_MANUFACTURING_NAICS");
  }

  if (!record.uei) reasons.push("UEI_REQUIRED");
  if (!record.legalBusinessName) {
    reasons.push("LEGAL_BUSINESS_NAME_REQUIRED");
  }

  return {
    eligibleForEmailAndGsaMatching: reasons.length === 0,
    reasons,
    blockedManufacturingNaics: manufacturing
  };
}

function isWithin(parent, child) {
  const relative = path.relative(
    path.resolve(parent),
    path.resolve(child)
  );
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () =>
      resolve(hash.digest("hex").toUpperCase())
    );
  });
}

class GovernmentDataNormalizerService {
  constructor(options = {}) {
    this.root = options.root || ROOT;
    this.contractPath =
      options.contractPath || DEFAULT_CONTRACT_PATH;
    this.stagingRoot =
      options.stagingRoot || DEFAULT_STAGING_ROOT;
    this.contract =
      options.contract ||
      JSON.parse(fs.readFileSync(this.contractPath, "utf8"));
  }

  assertStagingPath(target) {
    if (!isWithin(this.stagingRoot, target)) {
      throw new Error(
        `Operational write blocked outside staging: ${target}`
      );
    }
    return path.resolve(target);
  }

  value(fields, name) {
    const oneBased = this.contract.fields[name];
    if (!Number.isInteger(oneBased) || oneBased < 1) {
      throw new Error(`Unknown SAM field contract key: ${name}`);
    }
    return text(fields[oneBased - 1]);
  }

  parseLine(line, lineNumber = null) {
    const fields = String(line).split("|");
    const expected = this.contract.expectedFieldCount;
    if (fields.length !== expected) {
      throw new Error(
        `SAM field-count mismatch at line ${lineNumber ?? "unknown"}: ` +
        `expected ${expected}, received ${fields.length}`
      );
    }

    const website = normalizeWebsite(
      this.value(fields, "entityUrl")
    );
    const naics = parseNaics(
      this.value(fields, "naicsCodeString"),
      this.value(fields, "primaryNaics")
    );

    const record = {
      source: "SAM_PUBLIC_V2",
      sourceLine: lineNumber,
      uei: upper(this.value(fields, "uei")),
      cageCode: upper(this.value(fields, "cageCode")) || null,
      samExtractCode: upper(
        this.value(fields, "samExtractCode")
      ),
      registrationStatus:
        upper(this.value(fields, "samExtractCode")) === "A"
          ? "ACTIVE"
          : "EXPIRED",
      purposeOfRegistration: upper(
        this.value(fields, "purposeOfRegistration")
      ),
      initialRegistrationDate: compactDate(
        this.value(fields, "initialRegistrationDate")
      ),
      registrationExpirationDate: compactDate(
        this.value(fields, "registrationExpirationDate")
      ),
      lastUpdateDate: compactDate(
        this.value(fields, "lastUpdateDate")
      ),
      activationDate: compactDate(
        this.value(fields, "activationDate")
      ),
      legalBusinessName: this.value(
        fields,
        "legalBusinessName"
      ),
      ...website,
      entityStructure: upper(
        this.value(fields, "entityStructure")
      ),
      stateOfIncorporation: upper(
        this.value(fields, "stateOfIncorporation")
      ) || null,
      countryOfIncorporation: upper(
        this.value(fields, "countryOfIncorporation")
      ) || null,
      businessTypes: splitTilde(
        this.value(fields, "businessTypeString")
      ),
      ...naics,
      pscCodes: splitTilde(
        this.value(fields, "pscCodeString")
      ),
      debtSubjectToOffsetFlag: upper(
        this.value(fields, "debtSubjectToOffsetFlag")
      ) || null,
      exclusionStatusFlag: upper(
        this.value(fields, "exclusionStatusFlag")
      ) || null,
      sbaBusinessTypes: splitTilde(
        this.value(fields, "sbaBusinessTypesString")
      ),
      noPublicDisplayFlag: upper(
        this.value(fields, "noPublicDisplayFlag")
      ) || null,
      physicalAddress: {
        line1:
          this.value(fields, "physicalAddressLine1") || null,
        line2:
          this.value(fields, "physicalAddressLine2") || null,
        city:
          this.value(fields, "physicalAddressCity") || null,
        state:
          this.value(fields, "physicalAddressState") || null,
        postalCode:
          this.value(fields, "physicalAddressPostalCode") || null,
        countryCode:
          upper(
            this.value(fields, "physicalAddressCountryCode")
          ) || null
      },
      emailMergeRequired: true,
      authorityContactPreferred: true,
      verifiedEmails: []
    };

    return {
      ...record,
      normalizationGate: reasonCodes(record, this.contract)
    };
  }

  plan(options = {}) {
    const source = path.resolve(options.samDatPath || "");
    if (!source || !fs.existsSync(source)) {
      throw new Error(`SAM DAT file not found: ${source}`);
    }
    if (!isWithin(this.stagingRoot, source)) {
      throw new Error(
        `SAM DAT must be inside staging: ${source}`
      );
    }

    return {
      ok: true,
      mode: "PLAN_ONLY",
      source,
      expectedFieldCount: this.contract.expectedFieldCount,
      outputRoot: this.assertStagingPath(
        options.outputRoot ||
        path.join(this.stagingRoot, "normalized")
      ),
      safety: this.contract.safety
    };
  }

  async normalize(options = {}) {
    const plan = this.plan(options);
    const runId =
      options.runId ||
      `SAM-NORMALIZE-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`;
    const runRoot = this.assertStagingPath(
      path.join(plan.outputRoot, runId)
    );
    fs.mkdirSync(plan.outputRoot, { recursive: true });
    fs.mkdirSync(runRoot, { recursive: false });

    const acceptedPath = path.join(
      runRoot,
      "sam_candidates_for_email_and_gsa_matching.jsonl"
    );
    const rejectedPath = path.join(
      runRoot,
      "sam_rejected_pre_email.jsonl"
    );
    const accepted = fs.createWriteStream(acceptedPath, {
      flags: "wx"
    });
    const rejected = fs.createWriteStream(rejectedPath, {
      flags: "wx"
    });

    const input = fs.createReadStream(plan.source, {
      encoding: "utf8",
      highWaterMark: 1024 * 1024
    });
    const lines = readline.createInterface({
      input,
      crlfDelay: Infinity
    });

    const counts = {
      physicalLines: 0,
      dataRecords: 0,
      candidatesForMatching: 0,
      rejectedPreEmail: 0,
      malformed: 0
    };
    const rejectionReasons = {};
    let bof = null;

    try {
      for await (const line of lines) {
        counts.physicalLines += 1;
        if (counts.physicalLines === 1) {
          bof = line;
          if (!/^BOF PUBLIC V2\b/.test(line)) {
            throw new Error(
              `Unexpected SAM BOF record: ${line.slice(0, 80)}`
            );
          }
          continue;
        }
        if (!line.trim() || /^EOF\b/.test(line)) continue;

        let record;
        try {
          record = this.parseLine(line, counts.physicalLines);
        } catch (error) {
          counts.malformed += 1;
          throw error;
        }

        counts.dataRecords += 1;
        const gate = record.normalizationGate;
        const destination =
          gate.eligibleForEmailAndGsaMatching
            ? accepted
            : rejected;

        if (gate.eligibleForEmailAndGsaMatching) {
          counts.candidatesForMatching += 1;
        } else {
          counts.rejectedPreEmail += 1;
          for (const reason of gate.reasons) {
            rejectionReasons[reason] =
              (rejectionReasons[reason] || 0) + 1;
          }
        }

        if (!destination.write(`${JSON.stringify(record)}\n`)) {
          await new Promise(resolve =>
            destination.once("drain", resolve)
          );
        }
      }
    } finally {
      accepted.end();
      rejected.end();
      await Promise.all([
        new Promise(resolve => accepted.once("finish", resolve)),
        new Promise(resolve => rejected.once("finish", resolve))
      ]);
    }

    const artifacts = [];
    for (const filePath of [acceptedPath, rejectedPath]) {
      artifacts.push({
        filePath,
        bytes: fs.statSync(filePath).size,
        sha256: await hashFile(filePath)
      });
    }

    const manifest = {
      ok: counts.malformed === 0,
      mode: "STAGING_ONLY",
      status:
        counts.malformed === 0 ? "COMPLETED" : "FAILED",
      runId,
      generatedAt: new Date().toISOString(),
      source: {
        filePath: plan.source,
        bof
      },
      contract: {
        contractId: this.contract.contractId,
        version: this.contract.version,
        expectedFieldCount:
          this.contract.expectedFieldCount,
        mappingSha256: this.contract.mappingSha256
      },
      counts,
      rejectionReasons,
      artifacts,
      nextGate: {
        verifiedEmailRequired: true,
        authorityContactPreferred: true,
        genericMailboxFallbackOnly: true,
        contactSourceProvenanceRequired: true,
        currentGsaNaicsOrSinMatchRequired: true,
        deduplicationRequired: true,
        operationalAuthorization: false
      },
      safety: this.contract.safety
    };
    const manifestPath = path.join(runRoot, "manifest.json");
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );

    return {
      ...manifest,
      manifestPath
    };
  }
}

module.exports = GovernmentDataNormalizerService;
module.exports.compactDate = compactDate;
module.exports.parseNaics = parseNaics;
module.exports.normalizeWebsite = normalizeWebsite;
module.exports.reasonCodes = reasonCodes;
