"use strict";

const AwardHistoryTruthService = require("../SERVICES/orion/AwardHistoryTruthService");

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`[PASS] ${label}`);
}

const responses = [
  {
    results: [{ id: "x-R", uei: "ABC123", name: "ACME FEDERAL LLC", amount: 1000 }]
  },
  {
    results: [
      {
        "Award ID": "P1",
        "Recipient Name": "ACME FEDERAL LLC",
        "Award Amount": 100,
        "Awarding Agency": "Agency A",
        "Description": "Prime work"
      },
      {
        "Award ID": "P1",
        "Recipient Name": "ACME FEDERAL LLC",
        "Award Amount": 100,
        "Awarding Agency": "Agency A",
        "Description": "Duplicate award row"
      },
      {
        "Award ID": "P-X",
        "Recipient Name": "OTHER COMPANY LLC",
        "Award Amount": 999,
        "Awarding Agency": "Agency X",
        "Description": "Must not count"
      }
    ],
    page_metadata: { hasNext: false }
  },
  {
    results: [{
      "Award ID": "P2",
      "Recipient Name": "PRIME COMPANY LLC",
      "Award Amount": 200,
      "Awarding Agency": "Agency B",
      "Subawards": [
        {
          "Sub-Award ID": "S1",
          "Recipient Name": "ACME FEDERAL LLC",
          "Action Date": "2026-01-01",
          "Amount": 50,
          "Description": "Subcontract work"
        },
        {
          "Sub-Award ID": "S1",
          "Recipient Name": "ACME FEDERAL LLC",
          "Action Date": "2026-02-01",
          "Amount": 50,
          "Description": "Duplicate subcontract row"
        },
        {
          "Sub-Award ID": "S-X",
          "Recipient Name": "OTHER SUBCONTRACTOR LLC",
          "Action Date": "2026-01-01",
          "Amount": 400,
          "Description": "Must not count"
        }
      ]
    }],
    page_metadata: { hasNext: false }
  }
];

const fakeFetch = async () => {
  const body = responses.shift();
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text() { return JSON.stringify(body); }
  };
};

(async () => {
  const service = new AwardHistoryTruthService({ fetch: fakeFetch });
  const result = await service.auditByUei("ABC123");

  assert(result.ok === true, "audit succeeds");
  assert(result.status === "AUTHORITATIVE_AWARD_HISTORY_READ", "authoritative status recorded");
  assert(result.identity.uei === "ABC123", "UEI is authoritative identity key");
  assert(result.identity.canonicalNames[0] === "ACME FEDERAL LLC", "canonical recipient name resolved");
  assert(result.governingDefinition.federalRevenue === "PRIME_AWARDED_REVENUE_PLUS_SUBCONTRACTED_REVENUE", "federal revenue governing definition recorded");
  assert(result.governingDefinition.awardCount === "DISTINCT_PRIME_AWARDS_PLUS_DISTINCT_SUBCONTRACT_AWARDS", "award count governing definition recorded");
  assert(result.summary.primeAwardCount === 1, "distinct prime award count assembled");
  assert(result.summary.primeAwardedRevenue === 100, "prime awarded revenue assembled");
  assert(result.summary.subcontractAwardCount === 1, "distinct subcontract award count assembled");
  assert(result.summary.subcontractedRevenue === 50, "subcontracted revenue assembled");
  assert(result.summary.awardCount === 2, "combined distinct award count assembled");
  assert(result.summary.federalRevenue === 150, "federal revenue equals prime awarded plus subcontracted");
  assert(result.primeAwards[0].role === "PRIME", "prime role explicit");
  assert(result.subcontracts[0].role === "SUBCONTRACT", "subcontract role explicit");
  assert(result.dataQuality.excludedPrimeCandidateCount === 1, "mismatched prime candidate excluded");
  assert(result.dataQuality.excludedSubcontractCandidateCount === 1, "mismatched subcontract candidate excluded");
  assert(result.persistence.databaseWritesPerformed === false, "no database writes");
  assert(result.persistence.ledgerUpdated === false, "ledger not mutated before live validation");
  assert(result.safety.readOnly === true, "read-only safety recorded");
  assert(result.safety.emailsSent === false, "no emails sent");
  assert(result.safety.campaignsChanged === false, "no campaign changes");

  console.log("AWARD_HISTORY_TRUTH_TEST_PASS 21/21");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
