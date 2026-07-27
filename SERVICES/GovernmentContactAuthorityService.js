"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const DEFAULT_POLICY_PATH = path.join(
  ROOT,
  "CONFIG",
  "GOVERNMENT_DATA",
  "contact_enrichment_policy.json"
);
const DEFAULT_ELIGIBILITY_POLICY_PATH = path.join(
  ROOT,
  "CONFIG",
  "GOVERNMENT_DATA",
  "gsa_eligibility_policy.json"
);

function text(value) {
  return String(value ?? "").trim();
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(value));
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return /^(1|TRUE|YES|Y)$/i.test(text(value));
}

function verified(contact = {}) {
  const status = text(
    contact.verificationStatus ??
    contact.verification_status ??
    contact.emailStatus ??
    contact.email_status
  ).toUpperCase();

  return (
    truthy(contact.verified) ||
    truthy(contact.deliverable) ||
    truthy(contact.emailVerified) ||
    /^(VERIFIED|DELIVERABLE|VALID|OK|SAFE)$/.test(status)
  );
}

function emailParts(value) {
  const normalized = text(value).toLowerCase();
  if (!validEmail(normalized)) {
    return {
      email: normalized || null,
      localPart: null,
      domain: null
    };
  }
  const [localPart, domain] = normalized.split("@");
  return { email: normalized, localPart, domain };
}

function blockedSuffix(domain, suffixes) {
  const normalized = text(domain).toLowerCase();
  return suffixes.find(suffix => {
    const item = suffix.startsWith(".") ? suffix : `.${suffix}`;
    return (
      normalized === item.slice(1) ||
      normalized.endsWith(item)
    );
  }) || null;
}

function normalizeName(contact = {}) {
  return text(
    contact.name ??
    contact.fullName ??
    contact.full_name ??
    [
      contact.firstName ?? contact.first_name,
      contact.lastName ?? contact.last_name
    ].filter(Boolean).join(" ")
  );
}

function contactSource(contact = {}) {
  return text(
    contact.source ??
    contact.sourceName ??
    contact.source_name ??
    contact.provenance?.source
  );
}

class GovernmentContactAuthorityService {
  constructor(options = {}) {
    this.policy =
      options.policy ||
      JSON.parse(
        fs.readFileSync(
          options.policyPath || DEFAULT_POLICY_PATH,
          "utf8"
        )
      );
    this.eligibilityPolicy =
      options.eligibilityPolicy ||
      JSON.parse(
        fs.readFileSync(
          options.eligibilityPolicyPath ||
          DEFAULT_ELIGIBILITY_POLICY_PATH,
          "utf8"
        )
      );
  }

  authority(title) {
    const normalized = text(title);
    for (const tier of this.policy.authorityTiers || []) {
      if (
        (tier.titlePatterns || []).some(pattern =>
          new RegExp(pattern, "i").test(normalized)
        )
      ) {
        return {
          tier: tier.tier,
          score: tier.score,
          label: tier.label
        };
      }
    }
    return {
      tier: null,
      score: 0,
      label: "AUTHORITY_NOT_CONFIRMED"
    };
  }

  evaluate(contact = {}) {
    const email = emailParts(
      contact.email ??
      contact.emailAddress ??
      contact.email_address
    );
    const name = normalizeName(contact);
    const title = text(
      contact.title ??
      contact.jobTitle ??
      contact.job_title
    );
    const source = contactSource(contact);
    const authority = this.authority(title);
    const reasons = [];

    if (!email.email || !email.localPart || !email.domain) {
      reasons.push("VALID_EMAIL_REQUIRED");
    }
    if (!verified(contact)) {
      reasons.push("VERIFIED_DELIVERABLE_EMAIL_REQUIRED");
    }
    if (!source) {
      reasons.push("CONTACT_SOURCE_PROVENANCE_REQUIRED");
    }

    const suffix = blockedSuffix(
      email.domain,
      this.eligibilityPolicy.disallowedDomainSuffixes || []
    );
    if (suffix) reasons.push("DISALLOWED_EMAIL_DOMAIN");

    const blockedMailbox = (
      this.policy.blockedMailboxLocalParts || []
    ).includes(email.localPart);
    if (blockedMailbox) reasons.push("BLOCKED_MAILBOX_ROLE");

    const nonBuyerTitle = (
      this.policy.nonBuyerTitlePatterns || []
    ).some(pattern => new RegExp(pattern, "i").test(title));
    if (nonBuyerTitle) reasons.push("NON_BUYER_CONTACT_TITLE");

    const generic = (
      this.policy.genericMailboxLocalParts || []
    ).includes(email.localPart);
    const named = Boolean(name);
    const namedAuthority =
      named && authority.score > 0 && !generic;

    let rankingScore = authority.score;
    let contactType = "UNRANKED";
    if (namedAuthority) {
      rankingScore += 1000;
      contactType = "NAMED_AUTHORITY";
    } else if (generic) {
      rankingScore = 20;
      contactType = "GENERIC_FALLBACK";
    } else if (named) {
      rankingScore = 10;
      contactType = "NAMED_AUTHORITY_UNCONFIRMED";
    }

    return {
      eligible: reasons.length === 0,
      reasons,
      email: email.email,
      domain: email.domain,
      name: name || null,
      title: title || null,
      source: source || null,
      verified: verified(contact),
      verifiedAt:
        text(
          contact.verifiedAt ??
          contact.verified_at
        ) || null,
      generic,
      namedAuthority,
      contactType,
      authority,
      rankingScore,
      original: contact
    };
  }

  selectBest(contacts = []) {
    const evaluated = contacts.map(contact =>
      this.evaluate(contact)
    );
    const eligible = evaluated
      .filter(contact => contact.eligible)
      .sort((left, right) => {
        if (right.rankingScore !== left.rankingScore) {
          return right.rankingScore - left.rankingScore;
        }
        return String(left.email).localeCompare(
          String(right.email)
        );
      });

    const selected = eligible[0] || null;
    const status = !selected
      ? "NO_VERIFIED_CONTACT"
      : selected.namedAuthority
        ? "VERIFIED_AUTHORITY_CONTACT"
        : selected.generic
          ? "VERIFIED_GENERIC_FALLBACK"
          : "VERIFIED_CONTACT_AUTHORITY_UNCONFIRMED";

    return {
      status,
      contactFound: Boolean(selected),
      authorityContactFound: Boolean(
        selected?.namedAuthority
      ),
      selectedContact: selected,
      alternates: eligible.slice(1),
      rejectedContacts: evaluated.filter(
        contact => !contact.eligible
      ),
      campaignReady:
        Boolean(selected) &&
        Boolean(selected.verifiedAt) &&
        Boolean(selected.namedAuthority || selected.generic),
      approval: {
        campaignUploadAuthorized: false,
        emailSendAuthorized: false,
        kevinApprovalRequired: true
      }
    };
  }
}

module.exports = GovernmentContactAuthorityService;
module.exports.validEmail = validEmail;
module.exports.verified = verified;
module.exports.emailParts = emailParts;
