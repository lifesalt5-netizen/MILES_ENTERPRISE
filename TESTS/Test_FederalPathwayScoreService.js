"use strict";

const assert = require("assert");
const FederalPathwayScoreService = require("../SERVICES/FederalPathwayScoreService");

const service = new FederalPathwayScoreService();

const strong = service.evaluate({
  companyName: "Example Co",
  signals: {
    registration: { value: true, verified: true, source: "SAM" },
    vehicleAccess: { value: true, verified: true, source: "GSA" },
    federalSalesSignal: { value: true, verified: true, source: "USAspending" },
    agencyAlignment: { value: true, verified: true, source: "award analysis" },
    buyerTargeting: { value: true, verified: true, source: "buyer map" },
    opportunityFit: { value: true, verified: true, source: "opportunity analysis" },
    teamingPath: { value: true, verified: true, source: "prime analysis" },
    recompeteTiming: { value: true, verified: true, source: "recompete analysis" },
    certificationAlignment: { value: true, verified: true, source: "SBA" },
    captureProcess: { value: true, verified: true, source: "capture audit" }
  }
});

assert.equal(strong.score, 100);
assert.equal(strong.pathwayStatus, "READY");

const unverified = service.evaluate({
  companyName: "Unverified Co",
  signals: {
    registration: true,
    vehicleAccess: true,
    agencyAlignment: true
  }
});

assert.equal(unverified.score, 0);
assert.equal(unverified.pathwayStatus, "NEEDS_VALIDATION");
assert.equal(unverified.warnings.length, 3);

const partial = service.evaluate({
  companyName: "Partial Co",
  signals: {
    registration: { value: true, verified: true, source: "SAM" },
    vehicleAccess: { value: true, verified: true, source: "vehicle" },
    agencyAlignment: { value: true, verified: true, source: "agency" },
    buyerTargeting: { value: true, verified: true, source: "buyer" },
    opportunityFit: { value: true, verified: true, source: "opportunities" }
  }
});

assert.equal(partial.score, 60);
assert.equal(partial.pathwayStatus, "PARTIALLY_POSITIONED");
assert.ok(partial.topActions.length <= 3);

console.log("FederalPathwayScoreService tests passed");
