'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const P2GCProposalCommandService = require('../SERVICES/proposal/P2GCProposalCommandService');

const out = fs.mkdtempSync(path.join(os.tmpdir(),'p2gc-proposal-command-'));
const service = new P2GCProposalCommandService({outputDir:out});

const input = {
  solicitation:{
    id:'TEST-RFQ-001',title:'Controlled Government Solicitation Test',sourceUrl:'https://sam.gov/example',currentVersion:'0001',status:'OPEN',dueDate:'2026-09-30',setAside:'Small Business',vehicle:'OPEN MARKET',
    amendments:[],
    mandatoryRequirements:[
      {id:'R1',section:'L.1',description:'Provide technical approach',mandatory:true,responseLocation:'Technical Approach',evidenceRefs:['C1']},
      {id:'R2',section:'L.2',description:'Provide past performance',mandatory:true,responseLocation:'Past Performance',evidenceRefs:['C2']}
    ],
    sectionL:[{id:'L3',section:'L.3',description:'Submit management plan',mandatory:true,responseLocation:'Management Approach',evidenceRefs:['C1']}],
    sectionM:[{id:'M1',section:'M.1',description:'Technical approach and past performance will be evaluated.'}],
    submissionInstructions:['Submit through the Government-designated portal.'],governmentTemplates:['SF33-original.pdf']
  },
  client:{
    name:'Controlled Client LLC',uei:'TESTUEI123',cage:'TST01',primeEligibility:true,minimumQualifications:true,corporateExperienceQualified:true,requiredReferencesQualified:true,keyPersonnelQualified:true,securityRequirementsQualified:true,vehicleEligibility:true,solicitationCompliance:true
  },
  companyDNA:{
    companyName:'Controlled Client LLC',uei:'TESTUEI123',cage:'TST01',claims:[
      {id:'C1',claim:'Controlled technical capability',evidenceRefs:['evidence/technical.pdf'],clientAttested:true,publicUseApproved:false,lastVerified:'2026-08-23'},
      {id:'C2',claim:'Controlled past performance',evidenceRefs:['evidence/past-performance.pdf'],clientAttested:true,publicUseApproved:false,lastVerified:'2026-08-23'}
    ]
  },
  attestation:{clientAttested:true,attestedAt:'2026-08-23'},exactPageLimitsVerified:true,
  submissionFiles:[{name:'technical.pdf',sha256:'abc123',source:'generated-package',verified:true}],
  kevinApproval:{approved:false}
};

const r = service.run(input);
assert.equal(r.ok,true);
assert.equal(r.product,'P2GC Proposal Command™');
assert.equal(r.qualification.decision,'GO');
assert.equal(r.qualification.decisionCode,'GO');
assert.equal(r.compliance.compliancePercent,100);
assert.equal(r.protections.externalSubmissionEnabled,false);
assert.equal(r.submissionPackage.submitted,false);
assert.equal(r.submissionPackage.kevinApproval,'READY FOR KEVIN APPROVAL');
assert.equal(r.acceptance.productionAccepted,false);
assert.ok(r.pipeline.includes('Evaluator Review'));
assert.ok(fs.existsSync(r.evidenceFile));

const missing = service.run({solicitation:{id:'TEST-UNKNOWN',title:'Incomplete Test'}});
assert.equal(missing.qualification.proposalAuthorized,false);
assert.ok(missing.qualification.unknownChecks.length>0);
assert.equal(missing.submissionPackage.submitted,false);
assert.ok(missing.truthStates.includes('CLIENT INPUT REQUIRED'));
assert.ok(missing.truthStates.includes('EVIDENCE NEEDED'));

console.log('P2GC_PROPOSAL_COMMAND_CONTROLLED_E2E_PASS');
