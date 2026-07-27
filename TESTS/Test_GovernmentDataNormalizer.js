"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const GovernmentDataNormalizerService =
  require("../SERVICES/GovernmentDataNormalizerService");
const {
  parseArgs
} = require("../SCRIPTS/NormalizeGovernmentDataStaging");
const contract = require(
  "../CONFIG/GOVERNMENT_DATA/sam_public_v2_required_fields.json"
);

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "miles-sam-normalize-")
);
const stagingRoot = path.join(
  tempRoot,
  "DATA",
  "staging",
  "government_data"
);
fs.mkdirSync(stagingRoot, { recursive: true });

const service = new GovernmentDataNormalizerService({
  root: tempRoot,
  stagingRoot,
  contract,
  contractPath: path.join(tempRoot, "unused-contract.json")
});

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

function line(overrides = {}) {
  const values = Array(contract.expectedFieldCount).fill("");
  const set = (name, value) => {
    values[contract.fields[name] - 1] = value;
  };

  set("uei", "ABCDEF123456");
  set("cageCode", "1A2B3");
  set("samExtractCode", "A");
  set("purposeOfRegistration", "Z2");
  set("registrationExpirationDate", "20270427");
  set("lastUpdateDate", "20260429");
  set("legalBusinessName", "FEDERAL SYSTEMS LLC");
  set("entityUrl", "https://federalsystems.com/path");
  set("entityStructure", "2L");
  set("businessTypeString", "2X~8W~A2");
  set("primaryNaics", "541511");
  set("naicsCodeString", "541511Y~541519N");
  set("pscCodeString", "D399~R425");

  for (const [name, value] of Object.entries(overrides)) {
    set(name, value);
  }
  return values.join("|");
}

async function main() {
  test("official contract contains 142 fields", () => {
    assert.strictEqual(contract.expectedFieldCount, 142);
    assert.strictEqual(contract.fields.uei, 1);
    assert.strictEqual(contract.fields.noPublicDisplayFlag, 119);
  });

  test("active all-awards commercial entity is a match candidate", () => {
    const result = service.parseLine(line(), 2);
    assert.strictEqual(
      result.normalizationGate.eligibleForEmailAndGsaMatching,
      true
    );
    assert.deepStrictEqual(result.naicsCodes, [
      "541511",
      "541519"
    ]);
    assert.strictEqual(
      result.websiteDomain,
      "federalsystems.com"
    );
    assert.strictEqual(result.emailMergeRequired, true);
    assert.strictEqual(result.authorityContactPreferred, true);
    assert.deepStrictEqual(result.verifiedEmails, []);
  });

  test("expired record is rejected", () => {
    const result = service.parseLine(
      line({ samExtractCode: "E" }),
      2
    );
    assert(
      result.normalizationGate.reasons.includes(
        "SAM_RECORD_NOT_ACTIVE"
      )
    );
  });

  test("assistance-only registration is rejected", () => {
    const result = service.parseLine(
      line({ purposeOfRegistration: "Z1" }),
      2
    );
    assert(
      result.normalizationGate.reasons.includes(
        "NOT_REGISTERED_FOR_ALL_AWARDS"
      )
    );
  });

  test("tax-exempt structure is rejected", () => {
    const result = service.parseLine(
      line({ entityStructure: "8H" }),
      2
    );
    assert(
      result.normalizationGate.reasons.includes(
        "FOR_PROFIT_ENTITY_STRUCTURE_NOT_CONFIRMED"
      )
    );
  });

  test("manufacturing NAICS is rejected", () => {
    const result = service.parseLine(
      line({
        primaryNaics: "333999",
        naicsCodeString: "333999Y~541511N"
      }),
      2
    );
    assert(
      result.normalizationGate.reasons.includes(
        "EXCLUDED_MANUFACTURING_NAICS"
      )
    );
  });

  test("active exclusion flag is rejected", () => {
    const result = service.parseLine(
      line({ exclusionStatusFlag: "D" }),
      2
    );
    assert(
      result.normalizationGate.reasons.includes(
        "ACTIVE_SAM_EXCLUSION"
      )
    );
  });

  test("no-public-display record is rejected", () => {
    const result = service.parseLine(
      line({ noPublicDisplayFlag: "NPDY" }),
      2
    );
    assert(
      result.normalizationGate.reasons.includes(
        "PUBLIC_DISPLAY_NOT_AUTHORIZED"
      )
    );
  });

  test("field-count mismatch fails closed", () => {
    assert.throws(
      () => service.parseLine("A|B|C", 2),
      /expected 142, received 3/
    );
  });

  test("paths outside staging are blocked", () => {
    assert.throws(
      () => service.assertStagingPath(
        path.join(tempRoot, "ORION.db")
      ),
      /Operational write blocked/
    );
  });

  test("CLI is plan-only by default", () => {
    const parsed = parseArgs(["--sam-dat=C:\\stage\\sam.dat"]);
    assert.strictEqual(parsed.apply, false);
    assert.strictEqual(
      parsed.samDatPath,
      "C:\\stage\\sam.dat"
    );
  });

  const datPath = path.join(stagingRoot, "sample.dat");
  fs.writeFileSync(
    datPath,
    [
      "BOF PUBLIC V2 00000000 20260705 0000003 0000000",
      line(),
      line({ samExtractCode: "E" }),
      line({ entityStructure: "8H" })
    ].join("\n"),
    "utf8"
  );

  const result = await service.normalize({
    samDatPath: datPath,
    runId: "TEST-RUN"
  });

  test("streaming normalization writes staged artifacts only", () => {
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, "STAGING_ONLY");
    assert.strictEqual(result.counts.dataRecords, 3);
    assert.strictEqual(result.counts.candidatesForMatching, 1);
    assert.strictEqual(result.counts.rejectedPreEmail, 2);
    assert.strictEqual(
      result.safety.operationalWritesAllowed,
      false
    );
    assert.strictEqual(
      result.nextGate.operationalAuthorization,
      false
    );
    assert(fs.existsSync(result.manifestPath));
  });

  console.log(
    `GOVERNMENT_DATA_NORMALIZER_TEST_PASS ${passed}/${passed}`
  );
}

main()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempRoot, {
      recursive: true,
      force: true
    });
  });
