"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/GsaHolderSnapshotService");
const cli = require("../SCRIPTS/RefreshGsaHolderSnapshot");

function response(text, contentType = "application/json") {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type"
          ? contentType
          : null;
      }
    },
    async text() {
      return text;
    }
  };
}

async function run() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsa-holders-")
  );
  const csv = [
    [
      "Large Category",
      "Sub Category",
      "Source",
      "Cat",
      "Vendor",
      "Cont#",
      "Closed for New Award",
      "City",
      "State",
      "Phone",
      "Email",
      "URL",
      "Current Option Period End Date",
      "Ultimate Cont End Date",
      "SAM UEI",
      "Socio-Economic Indicators"
    ].join(","),
    [
      "Professional Services",
      "Business",
      "MAS",
      "541611",
      "Alpha LLC",
      "47QAAA26D0001",
      "",
      "Tampa",
      "FL",
      "555-0100",
      "owner@alpha.com",
      "https://alpha.com",
      "07/09/2031",
      "07/09/2046",
      "UEI-ALPHA",
      "s"
    ].join(","),
    [
      "Professional Services",
      "IT",
      "MAS",
      "54151S",
      "Alpha LLC",
      "47QAAA26D0001",
      "",
      "Tampa",
      "FL",
      "555-0100",
      "owner@alpha.com",
      "https://alpha.com",
      "07/09/2031",
      "07/09/2046",
      "UEI-ALPHA",
      "s"
    ].join(","),
    [
      "Professional Services",
      "Business",
      "MAS",
      "541611",
      "Beta LLC",
      "47QAAA20D0002",
      "",
      "Orlando",
      "FL",
      "555-0200",
      "owner@beta.com",
      "https://beta.com",
      "07/09/2030",
      "07/09/2040",
      "UEI-BETA",
      "s"
    ].join(",")
  ].join("\n");
  const awardPayload = {
    totalRecords: "1",
    awardSummary: [
      {
        contractId: {
          piid: "47QAAA26D0001",
          modificationNumber: "0"
        },
        awardDetails: {
          dates: {
            dateSigned: "2026-07-09T00:00:00Z"
          },
          awardeeData: {
            awardeeHeader: {
              awardeeName: "Alpha LLC"
            },
            awardeeUEIInformation: {
              uniqueEntityId: "UEI-ALPHA"
            }
          }
        }
      }
    ]
  };
  const urls = [];
  const fakeFetch = async url => {
    urls.push(String(url));
    if (String(url).includes("schedule_MAS.csv")) {
      return response(csv, "text/csv");
    }
    return response(JSON.stringify(awardPayload));
  };
  const service = new Service({ root, fetch: fakeFetch });
  const plan = service.plan({
    apiKey: "SECRET",
    pullMonth: "2026-07-15"
  });
  assert.strictEqual(plan.pullCycle, "2026-07");
  assert.strictEqual(
    plan.rules.samRegistrationDateProhibitedAsAwardDate,
    true
  );
  assert.strictEqual(plan.safety.operationalWritesAllowed, false);

  const result = await service.refresh({
    apiKey: "SECRET",
    pullMonth: "2026-07-15",
    runId: "TEST"
  });
  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.counts.eLibraryRows, 3);
  assert.strictEqual(result.counts.currentMasContracts, 2);
  assert.strictEqual(result.counts.newCurrentMasHolders, 1);
  assert.strictEqual(
    result.rules.samRegistrationDateUsedAsAwardDate,
    false
  );
  assert.strictEqual(
    result.nextGate.operationalAuthorization,
    false
  );
  assert(
    urls.some(url =>
      url.includes("awardOrIDVTypeName=FEDERAL+SUPPLY+SCHEDULE")
    )
  );
  const newPath = result.artifacts.find(item =>
    item.filePath.endsWith(
      "gsa_new_holders_current_month.jsonl"
    )
  ).filePath;
  const newHolder = JSON.parse(
    fs.readFileSync(newPath, "utf8").trim()
  );
  assert.strictEqual(
    newHolder.segment,
    "New GSA Holders This Month"
  );
  assert.strictEqual(
    newHolder.eLibraryEmailAcceptedWithoutVerification,
    false
  );
  assert.strictEqual(
    newHolder.firstGsaAwardDate,
    "2026-07-09T00:00:00Z"
  );
  assert.strictEqual(newHolder.contractTerm.termNumber, 1);
  assert.strictEqual(
    newHolder.contractTerm.termLabel,
    "TERM_1_BASE"
  );
  assert.strictEqual(
    Service.gsaContractTerm(
      "2020-07-09",
      "2026-07-28"
    ).termNumber,
    2
  );
  assert.strictEqual(
    Service.gsaContractTerm(
      "2008-07-09",
      "2026-07-28"
    ).termLabel,
    "TERM_4_FINAL"
  );
  assert.strictEqual(
    Service.gsaContractTerm(
      "2000-07-09",
      "2026-07-28"
    ).evidenceStatus,
    "BEYOND_20_YEAR_MAXIMUM_REVIEW_REQUIRED"
  );
  const holdersPath = result.artifacts.find(item =>
    item.filePath.endsWith("gsa_current_mas_holders.jsonl")
  ).filePath;
  const holders = fs.readFileSync(holdersPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  const beta = holders.find(item => item.uei === "UEI-BETA");
  assert.strictEqual(beta.contractTerm.termNumber, 2);
  assert.strictEqual(
    beta.contractTerm.evidenceStatus,
    "DERIVED_FROM_GSA_ELIBRARY_TERM_DATES"
  );
  assert.strictEqual(beta.firstGsaAwardDate, "2020-07-09");
  assert.strictEqual(beta.firstGsaAwardDateIsDerived, true);
  assert(!fs.readFileSync(result.manifestPath, "utf8")
    .includes("SECRET"));

  assert.deepStrictEqual(
    cli.parseArgs([
      "--apply",
      "--pull-month=2026-07-01",
      "--run-id=RUN"
    ]),
    {
      apply: true,
      pullMonth: "2026-07-01",
      runId: "RUN",
      help: false
    }
  );
  console.log("GSA_HOLDER_SNAPSHOT_TEST_PASS 25/25");
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
