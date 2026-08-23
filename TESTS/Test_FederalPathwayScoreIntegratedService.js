"use strict";

const assert = require("assert");
const FederalPathwayScoreIntegratedService = require("../SERVICES/FederalPathwayScoreIntegratedService");

function truthFixture(overrides = {}) {
  return {
    ok: true,
    identity: {
      name: "Example Federal Co",
      uei: "EXAMPLEUEI123",
      entityStatus: "ACTIVE",
      source: "ORION contractors"
    },
    vehicle: {
      current: "GSA MAS",
      status: "ORION_VEHICLE_RECORD_AVAILABLE"
    },
    awardHistory: {
      available: true,
      authoritativeForPersistence: true,
      status: "AUTHORITATIVE_AWARD_HISTORY_READ",
      summary: { federalRevenue: 1500000, awardCount: 4 },
      source: { name: "USAspending.gov", identityAuthority: "SAM.gov" }
    },
    agencyAlignment: {
      available: true,
      agencies: ["Department A", "Department B"]
    },
    opportunities: {
      available: true,
      records: [{ title: "Current fit", source: "SAM.GOV", status: "OPEN" }]
    },
    recompetes: {
      available: true,
      records: [{ title: "Recompete signal", availability: "ORION_RECOMPETE_SIGNAL" }]
    },
    recommendations: {
      buyer: ["Prioritize Department A"],
      partner: ["Evaluate Teaming Partner A"],
      certification: ["Evaluate certification alignment"]
    },
    availability: { awardHistory: true },
    ...overrides
  };
}

(async () => {
  const truthService = {
    async build() { return truthFixture(); }
  };

  const service = new FederalPathwayScoreIntegratedService({ truthService });
  const result = await service.evaluate("EXAMPLEUEI123");

  assert.equal(result.ok, true);
  assert.equal(result.status, "SCORE_READY");
  assert.equal(result.signals.registration.verified, true);
  assert.equal(result.signals.registration.value, true);
  assert.equal(result.signals.vehicleAccess.verified, true);
  assert.equal(result.signals.federalSalesSignal.verified, true);
  assert.equal(result.signals.agencyAlignment.verified, true);
  assert.equal(result.signals.buyerTargeting.verified, true);
  assert.equal(result.signals.opportunityFit.verified, true);

  assert.equal(result.signals.teamingPath.value, true);
  assert.equal(result.signals.teamingPath.verified, false);
  assert.equal(result.signals.recompeteTiming.value, true);
  assert.equal(result.signals.recompeteTiming.verified, false);
  assert.equal(result.signals.certificationAlignment.value, true);
  assert.equal(result.signals.certificationAlignment.verified, false);
  assert.equal(result.signals.captureProcess.verified, false);

  assert.equal(result.score.score, 70);
  assert.equal(result.score.pathwayStatus, "PARTIALLY_POSITIONED");
  assert.ok(result.evidenceNotes.some(x => /Recompete signals/.test(x)));

  const overrideService = new FederalPathwayScoreIntegratedService({ truthService });
  const overridden = await overrideService.evaluate("EXAMPLEUEI123", {
    supplementalEvidence: {
      teamingPath: { value: true, verified: true, source: "Signed teaming agreement" },
      recompeteTiming: { value: true, verified: true, source: "Authoritative agency forecast" },
      certificationAlignment: { value: true, verified: true, source: "SBA certification record plus validated set-aside demand" },
      captureProcess: { value: true, verified: true, source: "Documented P2GC capture workflow" }
    }
  });

  assert.equal(overridden.score.score, 100);
  assert.equal(overridden.score.pathwayStatus, "READY");

  const untrustedOverride = await overrideService.evaluate("EXAMPLEUEI123", {
    supplementalEvidence: {
      teamingPath: { value: true, verified: true }
    }
  });
  assert.equal(untrustedOverride.signals.teamingPath.verified, false);

  const failed = new FederalPathwayScoreIntegratedService({
    truthService: { async build() { return { ok: false, status: "CONTRACTOR_NOT_FOUND" }; } }
  });
  const missing = await failed.evaluate("Missing Co");
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "CONTRACTOR_NOT_FOUND");

  console.log("FederalPathwayScoreIntegratedService tests passed");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
