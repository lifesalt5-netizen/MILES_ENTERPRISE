"use strict";

const assert = require("assert");
const GovernmentContactAuthorityService =
  require("../SERVICES/GovernmentContactAuthorityService");

const policy = require(
  "../CONFIG/GOVERNMENT_DATA/contact_enrichment_policy.json"
);
const eligibilityPolicy = {
  disallowedDomainSuffixes: [
    ".org",
    ".gov",
    ".mil",
    ".edu",
    ".int",
    ".ngo",
    ".ong",
    ".church",
    ".charity",
    ".foundation",
    ".museum",
    ".school",
    ".college",
    ".university",
    ".academy",
    ".hotel",
    ".mortgage",
    ".loans",
    ".investments",
    ".restaurant",
    ".pizza",
    ".cafe",
    ".salon",
    ".spa",
    ".beauty",
    ".hair",
    ".pet"
  ]
};

const service = new GovernmentContactAuthorityService({
  policy,
  eligibilityPolicy
});

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

function contact(overrides = {}) {
  return {
    name: "Alex Morgan",
    title: "Chief Executive Officer",
    email: "alex@example.com",
    verificationStatus: "DELIVERABLE",
    verifiedAt: "2026-07-27T00:00:00.000Z",
    source: "verified_email_repository",
    ...overrides
  };
}

test("CEO is recognized as top authority", () => {
  const result = service.evaluate(contact());
  assert.strictEqual(result.eligible, true);
  assert.strictEqual(result.namedAuthority, true);
  assert.strictEqual(result.authority.tier, 1);
});

test("owner outranks business development director", () => {
  const result = service.selectBest([
    contact({
      name: "Taylor Reed",
      title: "Director of Federal Business Development",
      email: "taylor@example.com"
    }),
    contact({
      name: "Jordan Lee",
      title: "Owner",
      email: "jordan@example.com"
    })
  ]);
  assert.strictEqual(
    result.selectedContact.email,
    "jordan@example.com"
  );
});

test("authority contact outranks generic mailbox", () => {
  const result = service.selectBest([
    contact({
      name: "",
      title: "",
      email: "info@example.com"
    }),
    contact({
      title: "President",
      email: "president@example.com"
    })
  ]);
  assert.strictEqual(
    result.selectedContact.email,
    "president@example.com"
  );
  assert.strictEqual(result.authorityContactFound, true);
});

test("verified generic mailbox is fallback only", () => {
  const result = service.selectBest([
    contact({
      name: "",
      title: "",
      email: "info@example.com"
    })
  ]);
  assert.strictEqual(
    result.status,
    "VERIFIED_GENERIC_FALLBACK"
  );
  assert.strictEqual(result.authorityContactFound, false);
});

test("unverified email is rejected", () => {
  const result = service.evaluate(
    contact({
      verificationStatus: "",
      verified: false,
      deliverable: false
    })
  );
  assert(
    result.reasons.includes(
      "VERIFIED_DELIVERABLE_EMAIL_REQUIRED"
    )
  );
});

test("missing provenance is rejected", () => {
  const result = service.evaluate(contact({ source: "" }));
  assert(
    result.reasons.includes(
      "CONTACT_SOURCE_PROVENANCE_REQUIRED"
    )
  );
});

test("pattern-generated email is prohibited", () => {
  const result = service.evaluate(
    contact({
      email: "alex@example.com",
      source: "generated_email_pattern",
      patternGenerated: true
    })
  );
  assert(
    result.reasons.includes(
      "INFERRED_OR_FABRICATED_EMAIL_PROHIBITED"
    )
  );
});

test("disallowed institutional domain is rejected", () => {
  const result = service.evaluate(
    contact({ email: "ceo@example.org" })
  );
  assert(
    result.reasons.includes("DISALLOWED_EMAIL_DOMAIN")
  );
});

test("no-reply mailbox is rejected", () => {
  const result = service.evaluate(
    contact({
      name: "",
      title: "",
      email: "no-reply@example.com"
    })
  );
  assert(result.reasons.includes("BLOCKED_MAILBOX_ROLE"));
});

test("non-buyer title is rejected", () => {
  const result = service.evaluate(
    contact({ title: "Marketing Coordinator" })
  );
  assert(result.reasons.includes("NON_BUYER_CONTACT_TITLE"));
});

test("no verified contact fails closed", () => {
  const result = service.selectBest([
    contact({
      email: "bad-address",
      verificationStatus: ""
    })
  ]);
  assert.strictEqual(result.contactFound, false);
  assert.strictEqual(result.status, "NO_VERIFIED_CONTACT");
  assert.strictEqual(result.campaignReady, false);
});

test("campaign actions always require Kevin approval", () => {
  const result = service.selectBest([contact()]);
  assert.strictEqual(
    result.approval.campaignUploadAuthorized,
    false
  );
  assert.strictEqual(
    result.approval.emailSendAuthorized,
    false
  );
  assert.strictEqual(
    result.approval.kevinApprovalRequired,
    true
  );
});

console.log(
  `GOVERNMENT_CONTACT_AUTHORITY_TEST_PASS ${passed}/${passed}`
);
