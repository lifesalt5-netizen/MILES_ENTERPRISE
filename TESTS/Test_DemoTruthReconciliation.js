"use strict";

const assert = require("assert");
const DemoTruthReconciliationService = require("../SERVICES/demo/DemoTruthReconciliationService");

const reconcile = new DemoTruthReconciliationService();

const model = reconcile.reconcile({
  ok:true,
  status:"DEMO_READY",
  profile:{ samStatus:"A", gsaStatus:"NOT IDENTIFIED IN CURRENT ORION RECORD", contractVehicles:[] },
  currentState:{ samRegistration:false, contractVehicles:[], activeContracts:20, federalSales:0, agencyRelationships:[] },
  revenue:{ current:{ federal:0, state:0, local:0, commercial:0 }, opportunity:{ status:"ORION_MODELED_REVENUE_LEAKAGE_ESTIMATE", modeledPotentialFederalRevenue:665354, modeledGrowthOpportunity:665354 } },
  vehicles:{ current:[], recommendations:["Increase utilization of existing vehicles","Map existing vehicles to adjacent agency buyers"] },
  buyerIntelligence:{ records:[] },
  agencyAlignment:{ agencies:[] },
  recommendations:{
    immediate:["Address primary growth driver: Buyer Gap","Position outreach around persona: Agency Dependency Contractor","Use revenue leakage estimate of $665,354 as the commercial pain point"],
    vehicle:["Increase utilization of existing vehicles","Map existing vehicles to adjacent agency buyers"],
    agency:["Diversify buyer base beyond current concentration"],
    partner:[], opportunity:[], growth:[]
  },
  readiness:{ categories:{ relationships:{ evidence:["At least one agency/buyer relationship signal"] } } },
  gaps:{ items:["SAM entity appears active","SAM active","Increase utilization of existing vehicles","CAGE present"] },
  evidence:{}
});

assert.strictEqual(model.currentState.samRegistration, true, "profile SAM A must reconcile current-state SAM to true");
assert.ok(model.truthIntegrity.conflicts.includes("SAM_STATUS_CONTRADICTION"));
assert.strictEqual(model.currentState.activeContracts, null, "award count must not be mislabeled active contracts");
assert.strictEqual(model.currentState.awardCount, 20);
assert.strictEqual(model.revenue.current.federal, null, "zero revenue must fail closed when contradicted by award history without reconciled buyer history");
assert.strictEqual(model.revenue.opportunity.modeledGrowthOpportunity, null, "revenue model must be withheld while revenue truth conflicts");
assert.strictEqual(model.profile.gsaStatus, "NOT CONFIRMED FROM CURRENT EVIDENCE");
assert.ok(!model.recommendations.vehicle.some(x => /existing vehicles/i.test(x)));
assert.ok(!model.recommendations.agency.some(x => /current concentration/i.test(x)));
assert.ok(!model.gaps.items.some(x => /SAM active|SAM entity appears active/i.test(x)));
assert.strictEqual(model.status, "DEMO_REVIEW_REQUIRED");
assert.strictEqual(model.truthIntegrity.clientSafe, false);

const clean = reconcile.reconcile({
  ok:true,
  status:"DEMO_READY",
  profile:{ samStatus:"ACTIVE", gsaStatus:"IDENTIFIED", contractVehicles:["GSA MAS"] },
  currentState:{ samRegistration:true, contractVehicles:["GSA MAS"], activeContracts:null, federalSales:500000, agencyRelationships:["VA"] },
  revenue:{ current:{ federal:500000 }, opportunity:{ status:"POTENTIAL_REVENUE_NOT_MODELED", modeledGrowthOpportunity:null } },
  vehicles:{ current:["GSA MAS"], recommendations:["Increase utilization of existing vehicles"] },
  buyerIntelligence:{ records:[{agency:"VA",spend:500000,awardCount:4}] },
  agencyAlignment:{ agencies:[{agency:"VA"}] },
  recommendations:{ immediate:[],vehicle:["Increase utilization of existing vehicles"],agency:[],partner:[],opportunity:[],growth:[] },
  readiness:{ categories:{ relationships:{ evidence:["At least one agency/buyer relationship signal"] } } },
  gaps:{ items:[] },
  evidence:{}
});
assert.strictEqual(clean.truthIntegrity.status, "RECONCILED_FROM_AVAILABLE_EVIDENCE");
assert.strictEqual(clean.truthIntegrity.clientSafe, true);
assert.strictEqual(clean.revenue.current.federal, 500000);
assert.ok(clean.recommendations.vehicle.length === 1);

console.log("DEMO_TRUTH_RECONCILIATION_TEST_PASS");
