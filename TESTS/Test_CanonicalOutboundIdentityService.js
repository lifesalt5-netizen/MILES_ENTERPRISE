"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  CanonicalOutboundIdentityService,
  normalizeUei,
  normalizeEmail,
  normalizeDomain,
  normalizeName
} = require("../SERVICES/CanonicalOutboundIdentityService");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p1-3c-"));
  const auth = path.join(tmp, "auth");
  const state = path.join(tmp, "DATA", "OUTBOUND", "STATE_SLED");
  const out = path.join(tmp, "out");
  fs.mkdirSync(auth, { recursive: true });
  fs.mkdirSync(state, { recursive: true });

  // Deliberately contains duplicate 'email' headers to prove the parser does not fail.
  fs.writeFileSync(
    path.join(auth, "MASTER_DEDUPED_ALL_SEGMENTS.csv"),
    [
      "UEI,Legal_Name,State,Website,email,email",
      "ABC-123,Acme LLC,FL,https://www.acme.com,,sales@acme.com",
      ",Beta Inc,TX,www.beta.com,hello@beta.com,"
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    path.join(auth, "GSA_NO_SALES.csv"),
    [
      "UEI,Legal_Name,State,Website,Email",
      "XYZ999,Gamma Corp,VA,https://gamma.example,contact@gamma.example"
    ].join("\n"),
    "utf8"
  );

  const waveHeader = "UEI,Legal_Name,NORMALIZED_STATE,Website,POC_Email";
  fs.writeFileSync(
    path.join(state, "STATE_SLED_WAVE1_ENRICHMENT.csv"),
    [
      waveHeader,
      "ABC123,Acme LLC,FL,https://acme.com,",
      ",Beta Inc,TX,https://beta.com,hello@beta.com",
      ",Delta LLC,MD,https://delta.example,"
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(state, "STATE_SLED_WAVE2_ENRICHMENT.csv"),
    [waveHeader, "NEW111,New Co,CA,https://newco.example,"].join("\n"),
    "utf8"
  );

  const rules = {
    version: "test",
    authoritativeRoot: auth,
    stateSledRoot: "DATA\\OUTBOUND\\STATE_SLED",
    includeNamePatterns: ["MASTER_DEDUPED_ALL_SEGMENTS", "GSA_"],
    excludeNamePatterns: [],
    identity: {
      ueiFields: ["UEI"],
      emailFields: ["email", "Email", "POC_Email"],
      websiteFields: ["Website"],
      nameFields: ["Legal_Name"],
      stateFields: ["NORMALIZED_STATE", "State"]
    },
    safety: {
      createInstantlyCampaigns: false,
      uploadInstantlyLeads: false,
      activateCampaigns: false,
      deleteCampaigns: false
    }
  };

  const service = new CanonicalOutboundIdentityService({
    rootDir: tmp,
    rules,
    outDir: out
  });

  const result = await service.run();

  assert(result.ok === true, "service should succeed");
  assert(result.authoritativeFileCount === 2, "should select 2 authoritative files");
  assert(result.uniqueIdentities.uei === 2, "expected 2 unique UEIs");
  assert(result.uniqueIdentities.email === 3, "duplicate email header value must be preserved");

  const w1 = result.waveStats.find(x => x.wave === "WAVE1");
  const w2 = result.waveStats.find(x => x.wave === "WAVE2");

  assert(w1.total === 3, "wave1 total mismatch");
  assert(w1.overlap === 2, "wave1 should match Acme and Beta");
  assert(w1.clean === 1, "wave1 should leave Delta clean");
  assert(w2.clean === 1 && w2.overlap === 0, "wave2 New Co should remain clean");

  assert(normalizeUei("abc-123") === "ABC123", "UEI normalization failed");
  assert(normalizeEmail(" SALES@EXAMPLE.COM ") === "sales@example.com", "email normalization failed");
  assert(normalizeDomain("https://www.Example.com/a") === "example.com", "domain normalization failed");
  assert(normalizeName("A&B, LLC") === "A AND B LLC", "name normalization failed");

  assert(fs.existsSync(result.auditFile), "audit file missing");
  assert(fs.existsSync(path.join(out, "STATE_SLED_WAVE1_CLEAN_FOR_ENRICHMENT.csv")), "clean wave1 output missing");

  console.log("CANONICAL_OUTBOUND_IDENTITY_TEST=PASS");
  console.dir({
    authoritativeFileCount: result.authoritativeFileCount,
    uniqueIdentities: result.uniqueIdentities,
    waveStats: result.waveStats
  }, { depth: 8 });
})();
