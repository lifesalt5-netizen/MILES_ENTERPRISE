"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const DEFAULT_POLICY_PATH = path.join(
  ROOT,
  "CONFIG",
  "GOVERNMENT_DATA",
  "gsa_eligibility_policy.json"
);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return /^(1|TRUE|YES|Y|ACTIVE)$/i.test(normalizeText(value));
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function flattenValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (typeof value === "object") {
    return Object.values(value).flatMap(flattenValues);
  }
  return [normalizeText(value)].filter(Boolean);
}

function collectNaics(candidate = {}) {
  const values = flattenValues([
    candidate.naics,
    candidate.naicsCodes,
    candidate.primaryNaics,
    candidate.primary_naics,
    candidate.allMatchedNaics,
    candidate.all_matched_naics,
    candidate.assertions?.goodsAndServices?.naicsList
  ]);

  const codes = new Set();
  for (const value of values) {
    const matches = String(value).match(/\b\d{6}\b/g) || [];
    for (const match of matches) codes.add(match);
  }
  return Array.from(codes);
}

function collectSins(candidate = {}) {
  const values = flattenValues([
    candidate.sin,
    candidate.sins,
    candidate.matchedSin,
    candidate.matchedSins,
    candidate.matched_sin,
    candidate.gsaSin,
    candidate.gsaSins
  ]);

  const sins = new Set();
  for (const value of values) {
    for (const part of String(value).split(/[;,|~]+/)) {
      const normalized = normalizeUpper(part).replace(/\s+/g, "");
      if (normalized) sins.add(normalized);
    }
  }
  return Array.from(sins);
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(
    normalizeText(value)
  );
}

function emailEvidence(candidate = {}) {
  const formatted = new Set();
  const verified = new Set();

  const addFormatted = value => {
    const normalized = normalizeText(value).toLowerCase();
    if (validEmail(normalized)) formatted.add(normalized);
  };

  const addVerified = value => {
    const normalized = normalizeText(value).toLowerCase();
    if (!validEmail(normalized)) return;
    formatted.add(normalized);
    verified.add(normalized);
  };

  flattenValues([
    candidate.email,
    candidate.emails,
    candidate.emailAddress,
    candidate.email_address,
    candidate.contactEmail,
    candidate.contact_email,
    candidate.pocEmail,
    candidate.poc_email
  ]).forEach(addFormatted);

  flattenValues([
    candidate.verifiedEmail,
    candidate.verified_email,
    candidate.verifiedEmails,
    candidate.verified_emails,
    candidate.deliverableEmail,
    candidate.deliverable_email
  ]).forEach(addVerified);

  const globalStatus = normalizeUpper(
    candidate.emailVerificationStatus ??
    candidate.email_verification_status ??
    candidate.verificationStatus ??
    candidate.verification_status
  );

  const globallyVerified =
    truthy(candidate.emailVerified) ||
    truthy(candidate.email_verified) ||
    /^(VERIFIED|DELIVERABLE|VALID|OK|SAFE)$/.test(globalStatus);

  if (globallyVerified) {
    Array.from(formatted).forEach(addVerified);
  }

  const records = [
    ...(Array.isArray(candidate.emails) ? candidate.emails : []),
    ...(Array.isArray(candidate.emailRecords)
      ? candidate.emailRecords
      : [])
  ];

  for (const record of records) {
    if (!record || typeof record !== "object") continue;

    const address =
      record.email ??
      record.address ??
      record.value;

    const status = normalizeUpper(
      record.verificationStatus ??
      record.verification_status ??
      record.status
    );

    addFormatted(address);

    if (
      truthy(record.verified) ||
      truthy(record.deliverable) ||
      /^(VERIFIED|DELIVERABLE|VALID|OK|SAFE)$/.test(status)
    ) {
      addVerified(address);
    }
  }

  return {
    confirmed: verified.size > 0,
    formattedEmails: Array.from(formatted),
    verifiedEmails: Array.from(verified),
    verificationStatus: globalStatus || null
  };
}

function orgDomainEvidence(candidate = {}, email = {}) {
  const orgEmails = (email.verifiedEmails || []).filter(value => {
    const domain = String(value).split("@").pop().toLowerCase();
    return domain === "org" || domain.endsWith(".org");
  });

  const websiteValues = flattenValues([
    candidate.website,
    candidate.websites,
    candidate.websiteUrl,
    candidate.website_url,
    candidate.domain,
    candidate.websiteDomain,
    candidate.website_domain
  ]);

  const orgWebsites = websiteValues.filter(value => {
    let hostname = normalizeText(value).toLowerCase();
    if (!hostname) return false;

    try {
      const url = new URL(
        /^https?:\/\//i.test(hostname)
          ? hostname
          : `https://${hostname}`
      );
      hostname = url.hostname.toLowerCase();
    } catch {
      hostname = hostname
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        .split(":")[0];
    }

    return hostname === "org" || hostname.endsWith(".org");
  });

  return {
    blocked: orgEmails.length > 0 || orgWebsites.length > 0,
    orgEmails,
    orgWebsites
  };
}

function registrationStatus(candidate = {}) {
  return normalizeUpper(
    candidate.registrationStatus ??
    candidate.registration_status ??
    candidate.entityStatus ??
    candidate.entity_status ??
    candidate.entityRegistration?.registrationStatus
  );
}

function businessTypeText(candidate = {}) {
  return flattenValues([
    candidate.businessTypes,
    candidate.businessTypeList,
    candidate.coreData?.businessTypes,
    candidate.coreData?.businessTypes?.businessTypeList,
    candidate.entityRegistration?.businessTypes
  ]).join(" ");
}

function forProfitEvidence(candidate, policy) {
  if (typeof candidate.forProfit === "boolean") {
    return {
      confirmed: candidate.forProfit,
      source: "candidate.forProfit"
    };
  }

  const text = businessTypeText(candidate);
  const nonprofit = (policy.nonprofitPatterns || []).some(
    pattern => new RegExp(pattern, "i").test(text)
  );

  if (nonprofit) {
    return {
      confirmed: false,
      source: "SAM business type",
      evidence: text
    };
  }

  if (/\bfor[ -]?profit organization\b/i.test(text)) {
    return {
      confirmed: true,
      source: "SAM business type",
      evidence: text
    };
  }

  return {
    confirmed: null,
    source: null,
    evidence: text || null
  };
}

function exclusionEvidence(candidate = {}) {
  const status = normalizeUpper(
    candidate.exclusionStatus ??
    candidate.exclusion_status ??
    candidate.exclusionStatusFlag
  );

  const blocked =
    truthy(candidate.excluded) ||
    truthy(candidate.debarred) ||
    truthy(candidate.suspended) ||
    /EXCLUDED|DEBARRED|SUSPENDED/.test(status);

  return { blocked, status: status || null };
}

function companyAndIndustryText(candidate = {}) {
  return flattenValues([
    candidate.company,
    candidate.legalName,
    candidate.legalBusinessName,
    candidate.legal_name,
    candidate.industry,
    candidate.industryDescription,
    candidate.industry_segment,
    candidate.primaryNaicsDescription,
    candidate.notes
  ]).join(" ");
}

function industryExclusion(candidate, naics, policy) {
  const exact = new Set(policy.hardExcludedNaics || []);
  const prefixes = policy.hardExcludedNaicsPrefixes || [];

  const blockedNaics = naics.filter(
    code =>
      exact.has(code) ||
      prefixes.some(prefix => code.startsWith(prefix))
  );

  const text = companyAndIndustryText(candidate);
  const blockedPatterns = (policy.hardExcludedPatterns || []).filter(
    pattern => new RegExp(pattern, "i").test(text)
  );

  return {
    blocked: blockedNaics.length > 0 || blockedPatterns.length > 0,
    blockedNaics,
    blockedPatterns,
    evaluatedTextPresent: Boolean(text)
  };
}

function manufacturingExclusion(candidate, naics, policy) {
  const config = policy.manufacturingExclusion || {};
  if (config.enabled === false) {
    return {
      blocked: false,
      blockedNaics: [],
      blockedPatterns: []
    };
  }

  const prefixes = config.naicsPrefixes || [];
  const blockedNaics = naics.filter(
    code => prefixes.some(prefix => code.startsWith(prefix))
  );

  const text = companyAndIndustryText(candidate);
  const blockedPatterns = (config.patterns || []).filter(
    pattern => new RegExp(pattern, "i").test(text)
  );

  return {
    blocked: blockedNaics.length > 0 || blockedPatterns.length > 0,
    blockedNaics,
    blockedPatterns,
    evaluatedTextPresent: Boolean(text)
  };
}

function scaleEvidence(candidate = {}) {
  const signals = [];

  if (
    truthy(candidate.activeGsa) ||
    truthy(candidate.active_gsa) ||
    truthy(candidate.activeGsaContract)
  ) {
    signals.push("activeGsaContract");
  }

  const awardCount = numeric(
    candidate.awardCount ?? candidate.award_count
  );
  if (awardCount > 0) signals.push("federalAwardHistory");

  const federalRevenue = numeric(
    candidate.federalRevenue ?? candidate.federal_revenue
  );
  if (federalRevenue > 0) signals.push("positiveFederalRevenue");

  if (truthy(candidate.institutionalDeliveryCapability)) {
    signals.push("institutionalDeliveryCapability");
  }

  if (truthy(candidate.commercialScaleEvidence)) {
    signals.push("commercialScaleEvidence");
  }

  if (
    truthy(candidate.confirmedB2BOrB2GOperations) ||
    truthy(candidate.b2bOrB2g)
  ) {
    signals.push("confirmedB2BOrB2GOperations");
  }

  return {
    confirmed: signals.length > 0,
    signals,
    awardCount,
    federalRevenue
  };
}

function normalizeCrosswalk(crosswalk = {}) {
  return {
    naics: new Set(
      flattenValues(
        crosswalk.allowedNaics ?? crosswalk.naics
      ).map(value => normalizeText(value))
    ),
    sins: new Set(
      flattenValues(
        crosswalk.allowedSins ?? crosswalk.sins
      ).map(value => normalizeUpper(value).replace(/\s+/g, ""))
    )
  };
}

class GovernmentDataEligibilityService {
  constructor(options = {}) {
    this.policyPath = options.policyPath || DEFAULT_POLICY_PATH;
    this.policy =
      options.policy ||
      JSON.parse(fs.readFileSync(this.policyPath, "utf8"));
  }

  evaluate(candidate = {}, crosswalk = {}) {
    const policy = this.policy;
    const reasons = [];
    const reviewReasons = [];

    const status = registrationStatus(candidate);
    if (!["A", "ACTIVE"].includes(status)) {
      reasons.push("SAM_REGISTRATION_NOT_ACTIVE");
    }

    const profit = forProfitEvidence(candidate, policy);
    if (profit.confirmed === false) {
      reasons.push("NOT_FOR_PROFIT");
    } else if (profit.confirmed !== true) {
      reviewReasons.push("FOR_PROFIT_NOT_CONFIRMED");
    }

    const email = emailEvidence(candidate);
    if (!email.confirmed) {
      reasons.push("VERIFIED_DELIVERABLE_EMAIL_REQUIRED");
    }

    const orgDomain = orgDomainEvidence(candidate, email);
    if (orgDomain.blocked) {
      reasons.push("ORG_DOMAIN_NOT_ALLOWED");
    }

    const exclusion = exclusionEvidence(candidate);
    if (exclusion.blocked) {
      reasons.push("EXCLUDED_SUSPENDED_OR_DEBARRED");
    }

    const naics = collectNaics(candidate);
    const sins = collectSins(candidate);
    const industry = industryExclusion(
      candidate,
      naics,
      policy
    );

    if (industry.blocked) {
      reasons.push("EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS");
    }

    const manufacturing = manufacturingExclusion(
      candidate,
      naics,
      policy
    );
    if (manufacturing.blocked) {
      reasons.push("EXCLUDED_MANUFACTURING_OR_CUSTOM_MANUFACTURING");
    }

    const allowed = normalizeCrosswalk(crosswalk);
    const crosswalkLoaded =
      allowed.naics.size > 0 || allowed.sins.size > 0;

    const matchedNaics = naics.filter(code => allowed.naics.has(code));
    const matchedSins = sins.filter(sin => allowed.sins.has(sin));

    if (!crosswalkLoaded) {
      reviewReasons.push("GSA_CROSSWALK_NOT_LOADED");
    } else if (matchedNaics.length === 0 && matchedSins.length === 0) {
      reasons.push("NO_CURRENT_GSA_NAICS_OR_SIN_MATCH");
    }

    const scale = scaleEvidence(candidate);
    if (!scale.confirmed) {
      reviewReasons.push("FEDERAL_COMMERCIAL_SCALE_NOT_CONFIRMED");
    }

    const rejected = reasons.length > 0;
    const reviewRequired = !rejected && reviewReasons.length > 0;
    const eligible = !rejected && !reviewRequired;

    return {
      policyId: policy.policyId,
      policyVersion: policy.version,
      status: eligible
        ? "ELIGIBLE"
        : rejected
          ? "REJECTED"
          : "REVIEW_REQUIRED",
      eligible,
      loadAuthorized: eligible,
      reasons,
      reviewReasons,
      evidence: {
        registrationStatus: status || null,
        forProfit: profit,
        email,
        orgDomain,
        exclusion,
        naics,
        sins,
        matchedNaics,
        matchedSins,
        industry,
        manufacturing,
        scale,
        crosswalkLoaded
      }
    };
  }
}

module.exports = GovernmentDataEligibilityService;
