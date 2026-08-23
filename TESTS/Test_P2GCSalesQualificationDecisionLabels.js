'use strict';

const svc = require('../SERVICES/sales/P2GCSalesQualificationService');

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(`[FAIL] ${label}`);
  passed += 1;
  console.log(`[PASS] ${label}`);
}

const base = {
  primeEligibility:true,
  minimumQualifications:true,
  corporateExperience:true,
  requiredReferences:true,
  keyPersonnel:true,
  securityRequirements:true,
  vehicleEligibility:true,
  solicitationCompliance:true
};

let r = svc.qualify({...base});
check(r.decision === 'GO' && r.decisionCode === 'GO', 'GO label/code');

r = svc.qualify({...base, riskFlags:['client input pending']});
check(r.decision === 'GO WITH RISK' && r.decisionCode === 'GO_WITH_RISK', 'GO WITH RISK label/code');

r = svc.qualify({...base, primeEligibility:false, teamingMitigations:['qualified prime required']});
check(r.decision === 'TEAMING REQUIRED' && r.decisionCode === 'TEAMING_REQUIRED', 'TEAMING REQUIRED label/code');

r = svc.qualify({...base, primeEligibility:false});
check(r.decision === 'NO-GO' && r.decisionCode === 'NO_GO', 'NO-GO label/code');
check(r.proposalAuthorized === false, 'NO-GO blocks proposal authorization');

console.log(`P2GC_SALES_QUALIFICATION_DECISION_LABEL_TEST_PASS ${passed}/${passed}`);
