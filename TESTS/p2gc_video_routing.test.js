'use strict';

const assert = require('assert');
const Service = require('../SERVICES/revenue/P2GCVideoRoutingService');

class NoSuppression {
  get() { return null; }
}

const svc = new Service({ suppression: new NoSuppression(), now: () => '2026-09-05T19:30:00.000Z' });

function evidence(type) {
  return [{
    type,
    claim: 'Validated demonstration claim',
    source: 'ORION_VERIFIED_SOURCE',
    sourceId: 'test-1',
    freshness: '2026-09-05T18:00:00.000Z',
    confidence: 'HIGH',
    verified: true
  }];
}

{
  const r = svc.decision({ email: 'optout@example.com', optedOut: true });
  assert.equal(r.videoDecision, 'NO VIDEO');
  assert.equal(r.sendEligible, false);
}

{
  const r = svc.decision({
    prospectId: 'L1', companyName: 'Example One', email: 'one@example.com',
    requestedDemo: true, qualified: true, existingOutboundGovernancePermits: true
  });
  assert.equal(r.videoDecision, 'LEVEL 1 — REUSABLE');
  assert.equal(r.kevinApprovalRequired, 'NO');
  assert.equal(r.sendEligible, true);
  assert.equal(r.governance.sendExecutionImplemented, false);
}

{
  const r = svc.decision({
    prospectId: 'L2-BLOCKED', companyName: 'Example Two', email: 'two@example.com',
    replied: true, requestedDemo: true, maxPlaybackPct: 75,
    federalAwardHistory: true, activeVehicle: true, meaningfulRevenue: true,
    agencyConcentration: true, currentProcurementNeed: true,
    asksWhatP2GCFound: true, asksForCall: true,
    underusedVehicle: true,
    existingOutboundGovernancePermits: true
  });
  assert.notEqual(r.videoDecision, 'LEVEL 2 — SHORT PERSONALIZED');
  assert.equal(r.personalizedEvidenceReady, false);
}

{
  const r = svc.decision({
    prospectId: 'L2', companyName: 'Example Three', email: 'three@example.com',
    replied: true, requestedDemo: true, maxPlaybackPct: 75,
    federalAwardHistory: true, activeVehicle: true, meaningfulRevenue: true,
    poorVehicleUtilization: true, expansionOpportunity: true,
    asksWhatP2GCFound: true, mentionsActiveProblem: true,
    underusedVehicle: true,
    evidence: evidence('VEHICLE_UTILIZATION')
  });
  assert.equal(r.videoDecision, 'LEVEL 2 — SHORT PERSONALIZED');
  assert.equal(r.kevinApprovalRequired, 'YES');
  assert.equal(r.sendEligible, false);
}

{
  const r = svc.decision({
    prospectId: 'L3', companyName: 'Example Four', email: 'four@example.com',
    bookedAppointment: true,
    meaningfulFederalRevenueOrVehiclePosition: true,
    federalAwardHistory: true, meaningfulRevenue: true, activeVehicle: true,
    asksCompanySpecificReview: true, asksForCall: true,
    evidence: evidence('FEDERAL_POSITION')
  });
  assert.equal(r.videoDecision, 'LEVEL 3 — DEEP PERSONALIZED');
  assert.equal(r.kevinApprovalRequired, 'YES');
  assert.equal(r.recommendedSendTime, 'BEFORE_BOOKED_MEETING_AS_CALL_PREP');
  assert.equal(r.sendEligible, false);
}

console.log('P2GC_VIDEO_ROUTING_TESTS=PASS');
