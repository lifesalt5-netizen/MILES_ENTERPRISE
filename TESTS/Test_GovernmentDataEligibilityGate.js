"use strict";

const assert = require("assert");
const GovernmentDataEligibilityService =
  require("../SERVICES/GovernmentDataEligibilityService");

const service = new GovernmentDataEligibilityService();
const crosswalk = {
  allowedNaics: [
    "541511",
    "541611",
    "541715",
    "333999",
    "561210",
    "611430"
  ],
  allowedSins: [
    "54151S",
    "541611"
  ]
};

function base(overrides = {}) {
  return {
    company: "Federal Systems LLC",
    registrationStatus: "Active",
    forProfit: true,
    verifiedEmail: "qualified@example.com",
    primaryNaics: "541511",
    awardCount: 1,
    federalRevenue: 100000,
    ...overrides
  };
}

const tests = [
  {
    name: "eligible for-profit GSA NAICS contractor",
    candidate: base(),
    expected: "ELIGIBLE"
  },
  {
    name: "inactive SAM entity rejected",
    candidate: base({ registrationStatus: "Inactive" }),
    expected: "REJECTED",
    reason: "SAM_REGISTRATION_NOT_ACTIVE"
  },
  {
    name: "nonprofit rejected",
    candidate: base({ forProfit: false }),
    expected: "REJECTED",
    reason: "NOT_FOR_PROFIT"
  },
  {
    name: "no GSA NAICS or SIN match rejected",
    candidate: base({ primaryNaics: "999999" }),
    expected: "REJECTED",
    reason: "NO_CURRENT_GSA_NAICS_OR_SIN_MATCH"
  },
  {
    name: "dog walker rejected",
    candidate: base({
      company: "Best Dog Walking LLC",
      primaryNaics: "812910"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "car wash rejected",
    candidate: base({
      company: "Quick Car Wash LLC",
      primaryNaics: "811192"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "fast food rejected",
    candidate: base({
      company: "Fast Food Burgers LLC",
      primaryNaics: "722513"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "nail salon rejected",
    candidate: base({
      company: "Downtown Nail Salon LLC",
      primaryNaics: "812113"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "hotel rejected",
    candidate: base({
      company: "Airport Hotel LLC",
      primaryNaics: "721110"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "church rejected",
    candidate: base({
      company: "Community Church",
      primaryNaics: "813110"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "school rejected even when NAICS appears in crosswalk",
    candidate: base({
      company: "Local Training Academy",
      primaryNaics: "611430"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_INDUSTRY_OR_CONSUMER_MICROBUSINESS"
  },
  {
    name: "missing verified email rejected",
    candidate: base({
      verifiedEmail: null
    }),
    expected: "REJECTED",
    reason: "VERIFIED_DELIVERABLE_EMAIL_REQUIRED"
  },
  {
    name: "formatted but unverified email rejected",
    candidate: base({
      verifiedEmail: null,
      email: "unverified@example.com",
      emailVerified: false
    }),
    expected: "REJECTED",
    reason: "VERIFIED_DELIVERABLE_EMAIL_REQUIRED"
  },
  {
    name: "explicitly verified general email accepted",
    candidate: base({
      verifiedEmail: null,
      email: "verified@example.com",
      verificationStatus: "VERIFIED"
    }),
    expected: "ELIGIBLE"
  },
  {
    name: ".org verified email rejected",
    candidate: base({
      verifiedEmail: "contact@example.org"
    }),
    expected: "REJECTED",
    reason: "ORG_DOMAIN_NOT_ALLOWED"
  },
  {
    name: ".org company website rejected",
    candidate: base({
      website: "https://example.org"
    }),
    expected: "REJECTED",
    reason: "ORG_DOMAIN_NOT_ALLOWED"
  },
  {
    name: "manufacturing-sector NAICS rejected even with GSA match",
    candidate: base({
      company: "Precision Components LLC",
      primaryNaics: "333999"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_MANUFACTURING_OR_CUSTOM_MANUFACTURING"
  },
  {
    name: "custom manufacturing description rejected",
    candidate: base({
      company: "Custom Manufacturing Solutions LLC",
      primaryNaics: "541511"
    }),
    expected: "REJECTED",
    reason: "EXCLUDED_MANUFACTURING_OR_CUSTOM_MANUFACTURING"
  },
  {
    name: "no federal scale evidence requires review",
    candidate: base({
      awardCount: 0,
      federalRevenue: 0,
      activeGsa: false
    }),
    expected: "REVIEW_REQUIRED",
    reviewReason: "FEDERAL_COMMERCIAL_SCALE_NOT_CONFIRMED"
  },
  {
    name: "active GSA contract supplies scale evidence",
    candidate: base({
      awardCount: 0,
      federalRevenue: 0,
      activeGsa: true,
      matchedSins: ["54151S"]
    }),
    expected: "ELIGIBLE"
  },
  {
    name: "custom software is not blanket-excluded",
    candidate: base({
      company: "Custom Software Systems LLC",
      primaryNaics: "541511"
    }),
    expected: "ELIGIBLE"
  },
  {
    name: "missing crosswalk never authorizes load",
    candidate: base(),
    crosswalk: {},
    expected: "REVIEW_REQUIRED",
    reviewReason: "GSA_CROSSWALK_NOT_LOADED"
  }
];

for (const item of tests) {
  const result = service.evaluate(
    item.candidate,
    item.crosswalk ?? crosswalk
  );

  assert.strictEqual(
    result.status,
    item.expected,
    item.name
  );

  if (item.reason) {
    assert(
      result.reasons.includes(item.reason),
      item.name
    );
  }

  if (item.reviewReason) {
    assert(
      result.reviewReasons.includes(item.reviewReason),
      item.name
    );
  }

  if (result.status !== "ELIGIBLE") {
    assert.strictEqual(
      result.loadAuthorized,
      false,
      item.name
    );
  }
}

console.log(
  `GOVERNMENT_DATA_ELIGIBILITY_GATE_TEST_PASS ${tests.length}/${tests.length}`
);
