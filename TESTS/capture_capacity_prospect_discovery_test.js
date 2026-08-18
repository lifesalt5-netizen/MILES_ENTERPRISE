"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/CaptureCapacityProspectDiscoveryService");

class FakeCampaign {
  prepareAudience(leads, options = {}) {
    const evaluated = leads.map((lead, index) => {
      const good = Boolean(
        lead.email && lead.first_name && lead.company && lead.specific_current_need &&
        lead.specific_company_problem_or_vehicle && lead.vehicle_or_market && lead.specific_capture_problem &&
        Array.isArray(lead.triggers) && lead.triggers.length
      );
      return {
        index,
        lead,
        qualification: {
          eligible: good,
          email: lead.email || "",
          score: good ? 5 : 0,
          personalization: { company: lead.company || "" },
          blockers: good ? [] : ["MISSING_REQUIRED_DATA"]
        }
      };
    });
    const allEligible = evaluated.filter(x => x.qualification.eligible);
    const eligible = allEligible.slice(0, options.maxAudience || 2000);
    const blocked = evaluated.filter(x => !x.qualification.eligible);
    return {
      evaluated: evaluated.length,
      eligibleCount: eligible.length,
      blockedCount: blocked.length,
      capped: eligible.length < allEligible.length,
      cap: options.maxAudience || 2000,
      eligible,
      blocked
    };
  }

  async execute(input) {
    return { ok: true, preview: input.apply !== true, received: input.candidates.length };
  }
}

function service() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "miles-capture-feed-"));
  return new Service({
    rootDir: dir,
    outputDir: path.join(dir, "out"),
    campaignService: new FakeCampaign(),
    now: () => new Date("2026-08-18T19:00:00Z")
  });
}

(function testHiringSignal() {
  const result = service().discover({
    writeReport: false,
    contacts: [{ first_name: "Alex", company: "Acme Federal", email: "alex@acmefed.com", website: "acmefed.com" }],
    signals: [{ company: "Acme Federal", title: "Capture Director opening supporting DHS", description: "Hiring a Capture Director for DHS pursuits", agency: "DHS", source: "https://example.com/job", posted_date: "2026-08-10" }]
  });
  assert.equal(result.sourceCounts.qualifiedRows, 1);
  assert.equal(result.candidates[0].triggers[0].type, "CAPTURE_HIRING");
  assert.equal(result.candidates[0].vehicle_or_market, "DHS");
})();

(function testSourceEvidenceRequired() {
  const result = service().discover({
    writeReport: false,
    contacts: [{ first_name: "Sam", company: "NoSource Inc", email: "sam@nosource.com", website: "nosource.com" }],
    signals: [{ company: "NoSource Inc", title: "Capture Manager opening", description: "Hiring capture manager", agency: "DHS", source: "", posted_date: "2026-08-10" }]
  });
  assert.equal(result.sourceCounts.qualifiedRows, 0);
})();

(function testMultipleRecompetes() {
  const result = service().discover({
    writeReport: false,
    contacts: [{ first_name: "Dana", company: "Beta Systems", email: "dana@beta.com", website: "beta.com" }],
    signals: [
      { company: "Beta Systems", title: "DHS contract recompete", description: "Contract expires and recompetes in 2027", agency: "DHS", vehicle: "GSA MAS", source: "https://example.com/a", expiration_date: "2027-02-01" },
      { company: "Beta Systems", title: "VA recompete", description: "Second contract expiring for recompete", agency: "VA", vehicle: "T4NG2", source: "https://example.com/b", expiration_date: "2027-05-01" }
    ]
  });
  assert.equal(result.sourceCounts.qualifiedRows, 1);
  assert(result.candidates[0].triggers.some(t => t.type === "MULTIPLE_RECOMPETES"));
})();

(async function testHandoff() {
  const result = await service().discoverAndHandoff({
    writeReport: false,
    contacts: [{ first_name: "Lee", company: "Gamma LLC", email: "lee@gamma.com", website: "gamma.com" }],
    signals: [{ company: "Gamma LLC", title: "New GSA MAS award", description: "Awarded new contract vehicle GSA MAS", vehicle: "GSA MAS", source: "https://example.com/award", award_date: "2026-07-20" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.campaign.received, 1);
  console.log("PASS capture_capacity_prospect_discovery_test");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
