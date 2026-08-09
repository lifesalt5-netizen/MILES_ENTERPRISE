"use strict";

const ProspectDemoPresentationService = require("../SERVICES/revenue/ProspectDemoPresentationService");

const assessmentService = {
  build() {
    return {
      ok: true,
      status: "ASSESSMENT_READY",
      asOfDate: "2026-08-09",
      company: {
        company: "ACME FEDERAL LLC",
        uei: "ACMEUEI12345",
        city: "TAMPA",
        state: "FL",
        primaryNaics: "541512",
        smallBusinessFlag: "Y",
        federalRevenue: 125000,
        awardCount: 3,
        vehicle: "GSA",
        segment: "GROWTH_VENDOR"
      },
      persona: {
        primary: "Underutilized GSA Contractor",
        secondary: "Plateau Contractor",
        score: 85,
        vehicleGapScore: 55,
        growthExpansionScore: 80,
        agencyConcentrationScore: 50
      },
      recommendations: {
        topPriorityActions: ["Use revenue leakage estimate as the commercial pain point"],
        vehicle: ["Expand vehicle utilization"],
        buyer: ["Diversify buyer base"],
        partner: ["Identify teaming partners"]
      },
      buyerAlignment: [
        { company_id: 42, buyer_name: "Agency Buyer", agency: "Agency", spend: 50000 }
      ],
      linkedOpportunities: [
        { company_id: 42, source: "FORECAST", title: "Opportunity", status: "OPEN", due_date: "2026-10-01" }
      ],
      recompeteSignals: [
        {
          company_id: 42,
          title: "Recompete monitoring profile for ACME FEDERAL LLC",
          agency: "Agency",
          recompete_date: "2027-01-01",
          value: 1000000,
          signalType: "MONITORING_PROFILE",
          prospectClaim: "Modeled monitoring signal; not a confirmed procurement event."
        }
      ],
      dataQuality: { warnings: ["Modeled recompete requires validation."] },
      evidence: { contractorJoinKey: "contractors.id" },
      safety: { databaseMode: "READ_ONLY", writesEnabled: false }
    };
  }
};

const demoProtection = {
  evaluate() {
    return {
      allowed: true,
      demoMode: true,
      policyVersion: "1.0.0",
      redactImplementationDetails: true,
      redactRawEnterpriseData: true
    };
  }
};

const service = new ProspectDemoPresentationService({ assessmentService, demoProtection });
const result = service.build("ACMEUEI12345");

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("[PASS]", message);
}

assert(result.ok === true, "demo presentation succeeds");
assert(result.status === "DEMO_READY", "demo status ready");
assert(result.presentation.company.name === "ACME FEDERAL LLC", "company presented");
assert(result.presentation.priorityActions.length === 1, "priority actions presented");
assert(result.presentation.buyerAlignment[0] === "Agency", "buyer alignment summarized");
assert(result.presentation.currentOpportunities[0].title === "Opportunity", "opportunity summarized");
assert(result.presentation.recompeteSignals[0].signalType === "MONITORING_PROFILE", "recompete qualification preserved");
assert(!JSON.stringify(result.presentation).includes("contractorJoinKey"), "join internals redacted");
assert(!JSON.stringify(result.presentation).includes("company_id"), "raw company ids redacted");
assert(!JSON.stringify(result.presentation).includes("spend"), "raw buyer spend redacted");
assert(result.markdown.includes("ORION Government Growth Assessment"), "markdown generated");
assert(result.markdown.includes("Recommended Next Step"), "sales next step included");
assert(result.safety.demoMode === true, "demo mode enforced");
assert(result.safety.implementationDetailsRedacted === true, "implementation details redacted");
assert(result.safety.rawEnterpriseDataRedacted === true, "raw enterprise data redacted");
assert(result.safety.writesEnabled === false, "writes disabled");
assert(result.safety.emailsSent === false, "no email sending");
assert(result.safety.campaignsChanged === false, "no campaign changes");

console.log("PROSPECT_DEMO_PRESENTATION_TEST_PASS 18/18");
