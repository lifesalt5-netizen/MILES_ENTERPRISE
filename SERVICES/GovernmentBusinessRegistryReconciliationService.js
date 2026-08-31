"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const DEFAULT_POLICY_PATH = path.join(
  ROOT,
  "CONFIG",
  "GOVERNMENT_DATA",
  "business_registry_reconciliation_policy.json"
);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function normalizedName(value) {
  return upper(value)
    .replace(/&/g, " AND ")
    .replace(/\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LTD)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domain(value) {
  let raw = text(value).toLowerCase();
  if (!raw) return null;
  if (raw.includes("@")) raw = raw.split("@").pop();

  try {
    raw = new URL(
      /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    ).hostname;
  } catch {
    raw = raw
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0];
  }
  return raw.replace(/^www\./, "") || null;
}

function stateCode(record = {}) {
  return upper(
    record.state ??
    record.stateCode ??
    record.state_code ??
    record.physicalAddress?.state
  );
}

function legalName(record = {}) {
  return text(
    record.legalBusinessName ??
    record.legal_name ??
    record.company ??
    record.businessName ??
    record.business_name
  );
}

function dateValue(record = {}) {
  const value = text(
    record.sourceUpdatedAt ??
    record.source_updated_at ??
    record.lastUpdateDate ??
    record.last_updated ??
    record.updatedAt
  );
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceName(record = {}) {
  return upper(
    record.source ??
    record.sourceId ??
    record.source_id
  );
}

function exactMatch(left, right) {
  return Boolean(left && right && left === right);
}

class GovernmentBusinessRegistryReconciliationService {
  constructor(options = {}) {
    this.policy =
      options.policy ||
      JSON.parse(
        fs.readFileSync(
          options.policyPath || DEFAULT_POLICY_PATH,
          "utf8"
        )
      );
  }

  validateSource(record = {}) {
    const source = sourceName(record);
    if (!this.policy.sources[source]) {
      throw new Error(
        `Unrecognized business-registry source: ${source || "missing"}`
      );
    }
    return source;
  }

  match(sourceRecord = {}, samRecord = {}) {
    const sourceUei = upper(
      sourceRecord.uei ??
      sourceRecord.ueiSAM ??
      sourceRecord.uei_sam
    );
    const samUei = upper(
      samRecord.uei ??
      samRecord.ueiSAM ??
      samRecord.uei_sam
    );
    if (exactMatch(sourceUei, samUei)) {
      return { matched: true, method: "UEI_EXACT" };
    }

    const sourceCage = upper(
      sourceRecord.cageCode ?? sourceRecord.cage_code
    );
    const samCage = upper(
      samRecord.cageCode ?? samRecord.cage_code
    );
    if (exactMatch(sourceCage, samCage)) {
      return { matched: true, method: "CAGE_EXACT" };
    }

    const sourceRegistration = upper(
      sourceRecord.stateRegistrationId ??
      sourceRecord.state_registration_id
    );
    const samRegistration = upper(
      samRecord.stateRegistrationId ??
      samRecord.state_registration_id
    );
    const sourceJurisdiction = upper(
      sourceRecord.registrationJurisdiction ??
      sourceRecord.registration_jurisdiction ??
      stateCode(sourceRecord)
    );
    const samJurisdiction = upper(
      samRecord.registrationJurisdiction ??
      samRecord.registration_jurisdiction ??
      stateCode(samRecord)
    );
    if (
      exactMatch(sourceRegistration, samRegistration) &&
      exactMatch(sourceJurisdiction, samJurisdiction)
    ) {
      return {
        matched: true,
        method: "STATE_REGISTRATION_ID_AND_JURISDICTION_EXACT"
      };
    }

    const sourceDomain = domain(
      sourceRecord.website ??
      sourceRecord.websiteDomain ??
      sourceRecord.website_domain ??
      sourceRecord.email
    );
    const samDomain = domain(
      samRecord.website ??
      samRecord.websiteDomain ??
      samRecord.website_domain ??
      samRecord.email
    );
    if (exactMatch(sourceDomain, samDomain)) {
      return { matched: true, method: "WEBSITE_DOMAIN_EXACT" };
    }

    const sourceName = normalizedName(legalName(sourceRecord));
    const samName = normalizedName(legalName(samRecord));
    const sourceState = stateCode(sourceRecord);
    const samState = stateCode(samRecord);
    const sourcePostal = text(
      sourceRecord.postalCode ??
      sourceRecord.postal_code ??
      sourceRecord.physicalAddress?.postalCode
    ).slice(0, 5);
    const samPostal = text(
      samRecord.postalCode ??
      samRecord.postal_code ??
      samRecord.physicalAddress?.postalCode
    ).slice(0, 5);

    if (
      exactMatch(sourceName, samName) &&
      exactMatch(sourceState, samState) &&
      exactMatch(sourcePostal, samPostal)
    ) {
      return {
        matched: true,
        method: "LEGAL_NAME_STATE_ADDRESS_EXACT"
      };
    }

    return { matched: false, method: null };
  }

  findMatch(sourceRecord, samRecords = []) {
    const matches = [];
    for (const samRecord of samRecords) {
      const match = this.match(sourceRecord, samRecord);
      if (match.matched) {
        matches.push({ samRecord, ...match });
      }
    }

    for (const method of this.policy.matchPrecedence) {
      const sameMethod = matches.filter(
        item => item.method === method
      );
      if (sameMethod.length > 1) {
        return {
          status: "AMBIGUOUS_MATCH",
          method,
          matches: sameMethod
        };
      }
      if (sameMethod.length === 1) {
        return {
          status: "MATCHED",
          method,
          match: sameMethod[0].samRecord
        };
      }
    }

    return {
      status: "NOT_FOUND_IN_SAM",
      method: null,
      match: null
    };
  }

  reconcile(sourceRecord = {}, samRecords = []) {
    const source = this.validateSource(sourceRecord);
    const result = this.findMatch(sourceRecord, samRecords);
    const provenance = {
      source,
      authority: this.policy.sources[source].authority,
      sourceRecordId:
        text(
          sourceRecord.sourceRecordId ??
          sourceRecord.source_record_id ??
          sourceRecord.stateRegistrationId
        ) || null,
      sourceUpdatedAt:
        text(
          sourceRecord.sourceUpdatedAt ??
          sourceRecord.source_updated_at
        ) || null,
      capturedAt: new Date().toISOString()
    };

    if (result.status === "MATCHED") {
      return {
        status: "SAM_ENTITY_ENRICHMENT",
        matchMethod: result.method,
        samRecord: result.match,
        enrichment: sourceRecord,
        provenance,
        mayEnterSamMaster: true,
        mayEstablishSamRegistration: false,
        operationalAuthorization: false
      };
    }

    if (result.status === "AMBIGUOUS_MATCH") {
      return {
        status: "REVIEW_REQUIRED",
        reason: "AMBIGUOUS_SAM_ENTITY_MATCH",
        matchMethod: result.method,
        provenance,
        mayEnterSamMaster: false,
        mayEnterProspectPool: false,
        operationalAuthorization: false
      };
    }

    return {
      status: "SAM_REGISTRATION_OPPORTUNITY",
      samRegistrationStatus: "NOT_FOUND",
      prospectPool:
        this.policy.rules.unmatchedQualifiedBusinessPool,
      record: sourceRecord,
      provenance,
      mayEnterSamMaster: false,
      mayEnterProspectPool: true,
      eligibilityGateRequired: true,
      verifiedEmailRequired: true,
      authorityContactPreferred: true,
      operationalAuthorization: false
    };
  }

  newestWithinAuthority(records = []) {
    return [...records].sort(
      (left, right) => dateValue(right) - dateValue(left)
    )[0] || null;
  }
}

module.exports = GovernmentBusinessRegistryReconciliationService;
module.exports.normalizedName = normalizedName;
module.exports.domain = domain;
