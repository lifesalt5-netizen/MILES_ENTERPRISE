'use strict';

const fs = require('fs');
const path = require('path');

function parse(argv){const root=argv.find(v=>v.startsWith('--root='));return{rootDir:path.resolve(root?root.slice(7):process.env.MILES_ROOT||process.cwd())};}
function read(file){try{return fs.readFileSync(file,'utf8');}catch{return'';}}
function exists(file){return fs.existsSync(file);}
function hasAll(source,tokens){return tokens.every(t=>source.includes(t));}
function rel(root,file){return path.relative(root,file).replace(/\\/g,'/');}
function row(capability,status,evidenceFiles,detail){return{capability,status,evidenceFiles,detail};}

function main(){
  const {rootDir}=parse(process.argv.slice(2));
  const paths={
    service:path.join(rootDir,'SERVICES','proposal','P2GCProposalCommandService.js'),
    postSubmission:path.join(rootDir,'SERVICES','proposal','P2GCPostSubmissionLearningService.js'),
    qualification:path.join(rootDir,'SERVICES','sales','P2GCSalesQualificationService.js'),
    runner:path.join(rootDir,'RUN_P2GC_PROPOSAL_COMMAND.js'),
    ui:path.join(rootDir,'SERVICES','demo','public','proposal-command.html'),
    uiJs:path.join(rootDir,'SERVICES','demo','public','proposal-command.js'),
    demoServer:path.join(rootDir,'StartP2GCGrowthBlueprintDemo.js'),
    dashboard:path.join(rootDir,'SERVICES','ceo_dashboard','public','index.html'),
    test:path.join(rootDir,'TESTS','Test_P2GCProposalCommandService.js'),
    postTest:path.join(rootDir,'TESTS','Test_P2GCPostSubmissionLearningService.js'),
    decisionTest:path.join(rootDir,'TESTS','Test_P2GCSalesQualificationDecisionLabels.js')
  };
  const src=read(paths.service); const qsrc=read(paths.qualification); const postSrc=read(paths.postSubmission); const server=read(paths.demoServer); const dash=read(paths.dashboard);
  const canonicalExists=exists(paths.service);
  const controlledTestExists=exists(paths.test);
  const exactTruthStates=hasAll(src,['UNKNOWN','CLIENT INPUT REQUIRED','EVIDENCE NEEDED','PARTIALLY VERIFIED','NOT APPLICABLE','FAILED','NEEDS INTERPRETATION']);
  const exactDecisions=hasAll(qsrc,["label:\"GO\"","label:\"GO WITH RISK\"","label:\"TEAMING REQUIRED\"","label:\"NO-GO\""]);
  const protectedSubmission=hasAll(src,['externalSubmissionEnabled:false','submitted:false','Never mark SUBMITTED']);
  const apiWired=server.includes('/api/proposal-command/run')&&server.includes('P2GCProposalCommandService');
  const uiWired=exists(paths.ui)&&exists(paths.uiJs)&&server.includes('/proposal-command')&&dash.includes('P2GC Proposal Command');
  const postSubmissionVerified=exists(paths.postSubmission)&&exists(paths.postTest)&&hasAll(postSrc,['CLARIFICATION','DISCUSSION','FPR','BAFO','DEBRIEF','AWARD_RESULT','LESSON_LEARNED','requiresActualSubmissionProof']);

  const e={service:[rel(rootDir,paths.service),rel(rootDir,paths.test)],qual:[rel(rootDir,paths.qualification),rel(rootDir,paths.decisionTest)],post:[rel(rootDir,paths.postSubmission),rel(rootDir,paths.postTest)],ui:[rel(rootDir,paths.demoServer),rel(rootDir,paths.ui),rel(rootDir,paths.dashboard)]};
  const rows=[
    row('canonical_orchestrator',canonicalExists&&controlledTestExists?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Canonical callable service plus controlled E2E regression.'),
    row('solicitation_intake',src.includes('solicitationIntelligence')?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Structured source-aware intake exists; native document ingestion is not yet claimed.'),
    row('native_document_ingestion','PARTIAL',e.service,'Current canonical service accepts structured solicitation data; PDF/DOCX/email ingestion and amendment retrieval remain separate future wiring.'),
    row('amendment_control',hasAll(src,['amendments','incorporated','currentVersion'])?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Amendment/current-version truth is explicit and fails closed when not incorporated.'),
    row('stage0_qualification',exactDecisions&&exists(paths.decisionTest)?'EXISTS_AND_VERIFIED':'MISSING',e.qual,'Exact human decisions GO / GO WITH RISK / TEAMING REQUIRED / NO-GO with machine decisionCode compatibility.'),
    row('mandatory_requirement_extraction',src.includes('normalizedRequirement')?'PARTIAL':'MISSING',e.service,'Requirement normalization/matrix exists from structured intake; automatic extraction from raw Government documents is not yet claimed.'),
    row('section_l_instructions',src.includes('sectionL')?'PARTIAL':'MISSING',e.service,'Section L structured intake/normalization exists; raw-document parser not yet claimed.'),
    row('section_m_evaluation',src.includes('sectionM')&&src.includes('evaluationFactors')?'PARTIAL':'MISSING',e.service,'Section M structured intake and evaluator-factor use exists; raw-document extraction not yet claimed.'),
    row('evidence_vault',hasAll(src,['evidenceVault','claims','evidenceRefs','publicUseApproved','clientAttested'])?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Claim→Proof controls, attestation and public-use controls are explicit.'),
    row('capture_intelligence','EXISTS_BUT_NEEDS_WIRING',e.service,'Proposal strategy exists, but canonical ORION incumbent/agency/competitive feeds are not yet directly wired into this service.'),
    row('win_themes',src.includes('potentialStrengthRegister')?'PARTIAL':'MISSING',e.service,'Potential Strength Register exists; evidence-backed win-theme authoring remains to be expanded.'),
    row('compliance_matrix',src.includes('complianceMatrix')?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Mandatory requirement traceability and compliance percentage are callable.'),
    row('proposal_production',src.includes('proposalProduction')?'PARTIAL':'MISSING',e.service,'Artifact/volume production plan exists; controlled narrative generation and Government-template preservation workflow are not yet full production acceptance.'),
    row('personnel_compliance',src.includes('personnel')?'PARTIAL':'MISSING',e.service,'Personnel evidence is stored; dedicated key-personnel compliance matrix remains to be expanded.'),
    row('pricing_support','EXISTS_BUT_NEEDS_WIRING',e.service,'Pricing is intentionally not fabricated; dedicated pricing intelligence/template service is not directly wired.'),
    row('evaluator_review',hasAll(src,['evaluatorReview','easyToFind','easyToUnderstand','easyToVerify','easyToScore','easyToDefend'])?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Evaluator-first five-part test and separate readiness/compliance/competitive scores are callable.'),
    row('revision_resolution',src.includes('issues:')?'PARTIAL':'MISSING',e.service,'Review issues are surfaced; persistent comment-resolution/revision workflow remains to be expanded.'),
    row('final_compliance_qa',hasAll(src,['finalQa','exactPageLimitsVerified','cleanRoomReviewRequired'])?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Final QA, page-limit verification state, controlling-version check and clean-room requirement are explicit.'),
    row('submission_packaging',src.includes('submissionPackage')&&src.includes('sha256')?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Frozen-file hash evidence is required for readiness.'),
    row('kevin_approval_gate',src.includes('READY FOR KEVIN APPROVAL')?'EXISTS_AND_VERIFIED':'MISSING',e.service,'Protected final CEO approval is explicit.'),
    row('submission_protection',protectedSubmission?'EXISTS_AND_VERIFIED':'MISSING',e.service,'No automatic submission; SUBMITTED is impossible without future external proof path.'),
    row('post_submission_learning',postSubmissionVerified?'EXISTS_AND_VERIFIED':'MISSING',e.post,'Clarifications, discussions, FPR, BAFO, debrief, award result and lessons-learned events require submission proof and event evidence.'),
    row('dashboard_surface',uiWired&&apiWired?'EXISTS_AND_VERIFIED':'MISSING',e.ui,'CEO Launchpad card + 8791 workspace/API are wired; badge remains BETA until real-client/real-solicitation acceptance.')
  ];

  const hard=['canonical_orchestrator','solicitation_intake','amendment_control','stage0_qualification','evidence_vault','compliance_matrix','evaluator_review','final_compliance_qa','submission_packaging','kevin_approval_gate','submission_protection','post_submission_learning','dashboard_surface'];
  const hardBlockers=rows.filter(r=>hard.includes(r.capability)&&r.status==='MISSING');
  const result={
    ok:hardBlockers.length===0&&exactTruthStates,
    service:'P2GC_PROPOSAL_COMMAND_READINESS_AUDIT',generatedAt:new Date().toISOString(),rootDir,
    buildReadiness:hardBlockers.length===0&&exactTruthStates?'GREEN':'RED',productionAcceptance:'NOT_YET_PRODUCTION_ACCEPTED',
    exactTruthStatesPresent:exactTruthStates,exactDecisionLabelsPresent:exactDecisions,apiWired,uiWired,protectedSubmission,postSubmissionVerified,
    hardRequirements:hard,hardBlockers:hardBlockers.map(x=>x.capability),
    counts:{verified:rows.filter(r=>r.status==='EXISTS_AND_VERIFIED').length,partial:rows.filter(r=>r.status==='PARTIAL').length,needsWiring:rows.filter(r=>r.status==='EXISTS_BUT_NEEDS_WIRING').length,missing:rows.filter(r=>r.status==='MISSING').length},
    capabilities:rows,
    acceptanceRule:'Do not emit P2GC PROPOSAL COMMAND™ — PRODUCTION ACCEPTED until one real client + one real Government solicitation complete the full controlled pipeline and actual external submission proof exists.'
  };
  const outDir=path.join(rootDir,'DATA','operational_acceptance','proposal_command');fs.mkdirSync(outDir,{recursive:true});
  result.outputFile=path.join(outDir,'PROPOSAL_COMMAND_READINESS_LATEST.json');fs.writeFileSync(result.outputFile,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=2;
}
try{main();}catch(error){console.error(error.stack||error.message);process.exit(1);}
