"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const ProspectDemoTruthService = require("../SERVICES/digital_coo/ProspectDemoTruthService");
const ProspectDemoRuntimeService = require("../SERVICES/digital_coo/ProspectDemoRuntimeService");

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("[PASS]", message);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-prospect-demo-"));
  fs.mkdirSync(path.join(root, "DATA", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(root, "DATA", "revenue"), { recursive: true });
  fs.writeFileSync(path.join(root, "DATA", "runtime", "latest_deals.json"), JSON.stringify({
    deals: [{
      company: "ACME FEDERAL LLC",
      contactName: "Jane Buyer",
      email: "jane@acme.test",
      phone: "555-0100",
      title: "THIS MUST NOT BECOME A CONTACT TITLE",
      stage: "WARM_FOLLOW_UP",
      status: "ACTIVE",
      value: 5000,
      probability: 0.5,
      lastActivity: "2026-08-15T12:00:00Z"
    }]
  }, null, 2));

  const assessmentService = {
    build() {
      return {
        ok: true,
        service: "PROSPECT_GROWTH_ASSESSMENT",
        status: "ASSESSMENT_READY",
        generatedAt: "2026-08-15T12:00:00Z",
        asOfDate: "2026-08-15",
        match: { selectedContractorId: 42, selectedUei: "ACMEUEI12345" },
        company: {
          contractorId: 42,
          company: "ACME FEDERAL LLC",
          uei: "ACMEUEI12345",
          city: "TAMPA",
          state: "FL",
          primaryNaics: "541512",
          matchedNaics: "541512,541519",
          smallBusinessFlag: "Y",
          federalRevenue: 125000,
          awardCount: 3,
          vehicle: "GSA MAS",
          vehicleHint: "54151S",
          entityStatus: "ACTIVE",
          lastUpdated: "2026-08-14T00:00:00Z"
        },
        persona: { primary: "Underutilized GSA Contractor", vehicleGapScore: 55 },
        recommendations: {
          topPriorityActions: ["Expand agency access"],
          vehicle: ["Increase utilization of existing vehicle"],
          buyer: ["Diversify buyer base"],
          partner: ["Identify teaming partners"],
          opportunity: ["Screen linked opportunities"],
          growth: ["Prioritize capture"],
          lastUpdated: "2026-08-14T00:00:00Z"
        },
        buyerAlignment: [{ company_id: 42, agency: "Department of Example", spend: 100000 }],
        linkedOpportunities: [{ company_id: 42, title: "Live Opportunity", source: "FORECAST", status: "OPEN", due_date: "2026-10-01" }],
        recompeteSignals: [{ company_id: 42, title: "Recompete monitoring profile for ACME FEDERAL LLC", agency: "Department of Example", recompete_date: "2027-01-01", value: 1000000, signalType: "MONITORING_PROFILE", prospectClaim: "Modeled monitoring signal; not a confirmed procurement event." }],
        dataQuality: { warnings: ["Modeled recompete requires validation."] },
        evidence: { contractorJoinKey: "contractors.id", buyerJoinKey: "buyers.company_id", opportunityJoinKey: "opportunities.company_id", recompeteJoinKey: "recompetes.company_id" },
        safety: { databaseMode: "READ_ONLY", writesEnabled: false }
      };
    }
  };

  const presentationService = {
    build() {
      return {
        ok: true,
        presentation: {
          growthProfile: { primaryPersona: "Underutilized GSA Contractor", vehicleGapScore: 55 },
          currentOpportunities: [{ title: "Live Opportunity", source: "FORECAST", dueDate: "2026-10-01", status: "OPEN" }],
          recompeteSignals: [{ title: "Recompete monitoring profile for ACME FEDERAL LLC", agency: "Department of Example", expectedDate: "2027-01-01", estimatedValue: "$1,000,000", signalType: "MONITORING_PROFILE", qualification: "Modeled monitoring signal; not a confirmed procurement event." }]
        }
      };
    }
  };

  const awardHistoryService = {
    async auditByUei() {
      return {
        ok: true,
        status: "AUTHORITATIVE_AWARD_HISTORY_READ",
        generatedAt: "2026-08-15T12:30:00Z",
        source: { name: "USAspending.gov", authoritativeForPersistence: true, authoritativeLookupPerformed: true },
        identity: { uei: "ACMEUEI12345", canonicalNames: ["ACME FEDERAL LLC"] },
        summary: { federalRevenue: 125000, awardCount: 3, primeAwardedRevenue: 125000, primeAwardCount: 3, subcontractedRevenue: 0, subcontractAwardCount: 0 },
        primeAwards: [{ awardId: "A1", recipientName: "ACME FEDERAL LLC", amount: 125000, awardingAgency: "Department of Example", source: "USAspending.gov" }],
        subcontracts: [],
        dataQuality: { warnings: [] }
      };
    }
  };

  const truthService = new ProspectDemoTruthService({ rootDir: root, assessmentService, presentationService, awardHistoryService });
  const service = new ProspectDemoRuntimeService({ rootDir: root, truthService, ttlMs: 60000 });
  const result = await service.build("ACMEUEI12345");

  assert(result.ok === true, "prospect demo truth succeeds");
  assert(result.identity.name === "ACME FEDERAL LLC", "real company identity retained");
  assert(result.identity.uei === "ACMEUEI12345", "UEI retained");
  assert(result.identity.primaryNaics === "541512", "NAICS retained");
  assert(result.vehicle.current === "GSA MAS", "vehicle truth retained");
  assert(result.awardHistory.available === true, "authoritative award truth available");
  assert(result.awardHistory.source.name === "USAspending.gov", "award authority identified");
  assert(result.agencyAlignment.agencies[0] === "Department of Example", "agency alignment summarized");
  assert(result.opportunities.records[0].title === "Live Opportunity", "current opportunity retained");
  assert(result.recompetes.records[0].availability === "MODELED_MONITORING_SIGNAL", "modeled recompete is qualified");
  assert(result.contacts.records[0].email === "jane@acme.test", "local contact fact retained");
  assert(result.contacts.records[0].title === undefined, "ambiguous generic title is redacted");
  assert(result.leadFacts.records[0].stage === "WARM_FOLLOW_UP", "local lead fact retained");
  assert(result.request.matchedContractorId === undefined, "internal contractor id is redacted");
  assert(!JSON.stringify(result.evidence).includes("company_id"), "raw ORION company ids are not exposed");
  assert(!JSON.stringify(result.evidence).includes("contractors.id"), "internal join keys are redacted");
  assert(result.safety.writesEnabled === false && result.safety.externalMutationPerformed === false, "demo is read-only and non-mutating");

  const cached = await service.build("ACMEUEI12345");
  assert(cached.cache.hit === true, "subsequent screen/export request reuses same snapshot");
  const refreshed = await service.build("ACMEUEI12345", { forceRefresh: true });
  assert(refreshed.cache.hit === false, "explicit refresh rebuilds snapshot");

  const dir = path.join(root, "DATA", "demo_truth", "prospects", "acmeuei12345");
  assert(fs.existsSync(path.join(dir, "latest.json")), "sanitized JSON export persisted");
  assert(fs.existsSync(path.join(dir, "latest.md")), "Markdown export persisted");
  assert(fs.existsSync(path.join(dir, "latest.html")), "HTML export persisted");
  const persisted = fs.readFileSync(path.join(dir, "latest.json"), "utf8");
  assert(!persisted.includes("matchedContractorId"), "persisted export excludes internal contractor id");
  assert(!persisted.includes("THIS MUST NOT BECOME A CONTACT TITLE"), "persisted export excludes ambiguous contact title");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("PROSPECT_DEMO_TRUTH_P0_TEST_PASS 24/24");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
