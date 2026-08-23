'use strict';

const fs = require('fs');
const path = require('path');
const qualification = require('../sales/P2GCSalesQualificationService');

const TRUTH = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  CLIENT_INPUT_REQUIRED: 'CLIENT INPUT REQUIRED',
  EVIDENCE_NEEDED: 'EVIDENCE NEEDED',
  PARTIALLY_VERIFIED: 'PARTIALLY VERIFIED',
  NOT_APPLICABLE: 'NOT APPLICABLE',
  FAILED: 'FAILED',
  NEEDS_INTERPRETATION: 'NEEDS INTERPRETATION',
  VERIFIED: 'VERIFIED'
});

const PIPELINE = Object.freeze([
  'Solicitation Intelligence','Qualification','Requirements','Client Evidence','Compliance',
  'Proposal Strategy','Proposal Production','Evaluator Review','Correction','Final QA',
  'Submission Packaging','Submission Readiness','Post-Submission Learning'
]);

function arr(v){ return Array.isArray(v) ? v : []; }
function text(v){ return String(v ?? '').trim(); }
function boolKnown(v){ return v === true || v === false; }
function now(){ return new Date().toISOString(); }
function slug(v){ return text(v || 'proposal').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80) || 'proposal'; }
function uniq(values){ return [...new Set(values.filter(Boolean))]; }
function truth(value, missingState = TRUTH.UNKNOWN){
  if (value === null || value === undefined || value === '') return missingState;
  if (value === true) return TRUTH.VERIFIED;
  if (value === false) return TRUTH.FAILED;
  return TRUTH.PARTIALLY_VERIFIED;
}
function requirementId(row, index){ return text(row?.id || row?.requirementId || row?.number) || `REQ-${String(index+1).padStart(3,'0')}`; }
function normalizedRequirement(row, index, source='SOLICITATION'){
  const description = text(row?.description || row?.text || row?.requirement);
  return {
    id: requirementId(row,index),
    source: text(row?.source || source) || source,
    section: text(row?.section) || TRUTH.UNKNOWN,
    description: description || TRUTH.UNKNOWN,
    mandatory: row?.mandatory !== false,
    pageLimit: row?.pageLimit ?? null,
    responseLocation: text(row?.responseLocation) || null,
    evidenceRefs: arr(row?.evidenceRefs).map(text).filter(Boolean),
    status: description ? TRUTH.PARTIALLY_VERIFIED : TRUTH.NEEDS_INTERPRETATION
  };
}
function stage(name,status,detail={}){ return {name,status,...detail}; }

class P2GCProposalCommandService {
  constructor(options={}){
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname,'..','..'));
    this.outputDir = options.outputDir || path.join(this.rootDir,'DATA','proposal_command');
  }

  solicitationIntelligence(input={}){
    const s = input.solicitation || {};
    const mandatory = arr(s.mandatoryRequirements).map((r,i)=>normalizedRequirement(r,i,'SOLICITATION'));
    const l = arr(s.sectionL).map((r,i)=>normalizedRequirement(r,i,'SECTION_L'));
    const m = arr(s.sectionM).map((r,i)=>normalizedRequirement(r,i,'SECTION_M'));
    const amendments = arr(s.amendments).map((a,i)=>({
      id:text(a?.id || a?.number) || `AMD-${i+1}`,
      date:text(a?.date)||TRUTH.UNKNOWN,
      sourceUrl:text(a?.sourceUrl)||null,
      incorporated:a?.incorporated === true,
      status:a?.incorporated === true ? TRUTH.VERIFIED : TRUTH.NEEDS_INTERPRETATION
    }));
    const currentSolicitation = Boolean(text(s.id) && text(s.title) && (text(s.sourceUrl) || text(s.currentVersion)));
    const amendmentGap = amendments.some(a=>!a.incorporated);
    const status = !currentSolicitation ? TRUTH.CLIENT_INPUT_REQUIRED : amendmentGap ? TRUTH.PARTIALLY_VERIFIED : TRUTH.VERIFIED;
    return {
      status,
      solicitationId:text(s.id)||null,
      title:text(s.title)||null,
      sourceUrl:text(s.sourceUrl)||null,
      currentVersion:text(s.currentVersion)||null,
      solicitationStatus:text(s.status)||TRUTH.UNKNOWN,
      dueDate:text(s.dueDate)||TRUTH.UNKNOWN,
      setAside:text(s.setAside)||TRUTH.UNKNOWN,
      vehicle:text(s.vehicle)||TRUTH.UNKNOWN,
      qAndA:arr(s.qAndA),
      amendments,
      mandatoryRequirements:mandatory,
      sectionL:l,
      sectionM:m,
      submissionInstructions:arr(s.submissionInstructions),
      governmentTemplates:arr(s.governmentTemplates),
      hierarchy:['CURRENT_SOLICITATION','AMENDMENTS_QA_GOV_TEMPLATES','ACQUISITION_RULES','PROCUREMENT_EVALUATION_PLAYBOOKS','DOMAIN_PLAYBOOK','P2GC_STANDARD','CLIENT_COMPANY_DNA','HISTORICAL_LESSONS']
    };
  }

  qualify(input={}, solicitation={}){
    const c = input.client || {};
    const checks = {
      primeEligibility:c.primeEligibility,
      minimumQualifications:c.minimumQualifications,
      corporateExperience:c.corporateExperienceQualified,
      requiredReferences:c.requiredReferencesQualified,
      keyPersonnel:c.keyPersonnelQualified,
      securityRequirements:c.securityRequirementsQualified,
      vehicleEligibility:c.vehicleEligibility,
      solicitationCompliance:c.solicitationCompliance
    };
    const unknownChecks = Object.entries(checks).filter(([,v])=>!boolKnown(v)).map(([k])=>k);
    const riskFlags = uniq([...arr(input.riskFlags).map(text), ...unknownChecks.map(k=>`${k}: ${TRUTH.CLIENT_INPUT_REQUIRED}`)]);
    const q = qualification.qualify({
      opportunityId:solicitation.solicitationId,
      title:solicitation.title,
      primeEligibility:checks.primeEligibility === true,
      minimumQualifications:checks.minimumQualifications === true,
      corporateExperience:checks.corporateExperience === true,
      requiredReferences:checks.requiredReferences === true,
      keyPersonnel:checks.keyPersonnel === true,
      securityRequirements:checks.securityRequirements === true,
      vehicleEligibility:checks.vehicleEligibility === true,
      solicitationCompliance:checks.solicitationCompliance === true,
      riskFlags,
      teamingMitigations:arr(input.teamingMitigations)
    });
    return {
      ...q,
      status:unknownChecks.length ? TRUTH.CLIENT_INPUT_REQUIRED : (q.decision === 'NO-GO' ? TRUTH.FAILED : TRUTH.VERIFIED),
      unknownChecks,
      exactDecision:q.decision
    };
  }

  evidenceVault(input={}){
    const company = input.companyDNA || input.client?.companyDNA || {};
    const claims = arr(company.claims).map((c,i)=>{
      const refs = arr(c?.evidenceRefs).map(text).filter(Boolean);
      return {
        id:text(c?.id)||`CLAIM-${String(i+1).padStart(3,'0')}`,
        claim:text(c?.claim)||TRUTH.UNKNOWN,
        evidenceRefs:refs,
        publicUseApproved:c?.publicUseApproved === true,
        clientAttested:c?.clientAttested === true,
        lastVerified:text(c?.lastVerified)||null,
        status:refs.length ? (c?.clientAttested === true ? TRUTH.VERIFIED : TRUTH.PARTIALLY_VERIFIED) : TRUTH.EVIDENCE_NEEDED
      };
    });
    return {
      status:claims.length && claims.every(c=>c.status === TRUTH.VERIFIED) ? TRUTH.VERIFIED : claims.length ? TRUTH.PARTIALLY_VERIFIED : TRUTH.CLIENT_INPUT_REQUIRED,
      companyName:text(company.companyName || input.client?.name)||null,
      uei:text(company.uei || input.client?.uei)||null,
      cage:text(company.cage || input.client?.cage)||null,
      claims,
      pastPerformance:arr(company.pastPerformance),
      personnel:arr(company.personnel),
      certifications:arr(company.certifications),
      licenses:arr(company.licenses),
      rules:{claimRequiresProof:true,noFabrication:true,publicUseRequiresApproval:true}
    };
  }

  complianceMatrix(solicitation,evidence){
    const rows = [...solicitation.mandatoryRequirements,...solicitation.sectionL].map((r,i)=>{
      const refs = uniq([...arr(r.evidenceRefs), ...evidence.claims.filter(c=>r.evidenceRefs?.includes(c.id)).flatMap(c=>c.evidenceRefs)]);
      const satisfied = Boolean(r.description && r.description !== TRUTH.UNKNOWN && (r.mandatory === false || r.responseLocation || refs.length));
      return {
        id:r.id || `CMP-${i+1}`,
        requirement:r.description,
        source:r.source,
        mandatory:r.mandatory,
        pageLimit:r.pageLimit,
        responseLocation:r.responseLocation || TRUTH.CLIENT_INPUT_REQUIRED,
        evidenceRefs:refs,
        status:satisfied ? TRUTH.PARTIALLY_VERIFIED : (r.mandatory ? TRUTH.EVIDENCE_NEEDED : TRUTH.NOT_APPLICABLE)
      };
    });
    const mandatory = rows.filter(r=>r.mandatory);
    const complete = mandatory.filter(r=>[TRUTH.PARTIALLY_VERIFIED,TRUTH.VERIFIED].includes(r.status)).length;
    return {
      status:mandatory.length && complete === mandatory.length ? TRUTH.PARTIALLY_VERIFIED : TRUTH.EVIDENCE_NEEDED,
      rows,
      mandatoryCount:mandatory.length,
      mandatoryAddressed:complete,
      compliancePercent:mandatory.length ? Math.round((complete/mandatory.length)*100) : 0
    };
  }

  strategy(solicitation,qualificationResult,compliance,evidence){
    const factors = solicitation.sectionM.map(r=>({factor:r.description,status:r.description===TRUTH.UNKNOWN?TRUTH.NEEDS_INTERPRETATION:TRUTH.PARTIALLY_VERIFIED}));
    const strengths = evidence.claims.filter(c=>c.status===TRUTH.VERIFIED).map(c=>({claimId:c.id,claim:c.claim,test:'Easy to Find / Understand / Verify / Score / Defend'}));
    return {
      status:qualificationResult.proposalAuthorized ? TRUTH.PARTIALLY_VERIFIED : TRUTH.FAILED,
      evaluationFactors:factors,
      potentialStrengthRegister:strengths,
      primeVsTeaming:qualificationResult.decision === 'TEAMING REQUIRED' ? 'TEAMING' : qualificationResult.proposalAuthorized ? 'PRIME_CANDIDATE' : 'DO_NOT_PRIME',
      priorities:uniq([
        compliance.compliancePercent < 100 ? 'Close mandatory compliance gaps before drafting.' : null,
        strengths.length === 0 ? 'Add verified Claim→Proof evidence before competitive drafting.' : null,
        factors.length === 0 ? 'Extract Section M/evaluation factors from the controlling solicitation.' : null
      ])
    };
  }

  proposalProduction(solicitation,compliance,evidence){
    const sectionNames = uniq(compliance.rows.map(r=>text(r.responseLocation)).filter(v=>v && v!==TRUTH.CLIENT_INPUT_REQUIRED));
    const artifacts = [
      {category:'A',name:'Government-required originals/templates',status:solicitation.governmentTemplates.length?TRUTH.PARTIALLY_VERIFIED:TRUTH.NOT_APPLICABLE,rule:'Never recreate when the Government requires the original.'},
      {category:'B',name:'Compliance and instruction artifacts',status:compliance.rows.length?TRUTH.PARTIALLY_VERIFIED:TRUTH.EVIDENCE_NEEDED},
      {category:'C',name:'Narrative proposal volumes',status:sectionNames.length?TRUTH.PARTIALLY_VERIFIED:TRUTH.CLIENT_INPUT_REQUIRED,sections:sectionNames},
      {category:'D',name:'Evidence and submission support',status:evidence.claims.length?TRUTH.PARTIALLY_VERIFIED:TRUTH.EVIDENCE_NEEDED}
    ];
    return {status:artifacts.some(a=>a.status===TRUTH.EVIDENCE_NEEDED)?TRUTH.EVIDENCE_NEEDED:TRUTH.PARTIALLY_VERIFIED,artifacts,noPlaceholderText:true,pageLimitsMustBeExact:true};
  }

  evaluatorReview(compliance,evidence,strategy){
    const proof = evidence.claims.filter(c=>c.status===TRUTH.VERIFIED).length;
    const criteria = {
      easyToFind:Math.min(100,compliance.compliancePercent),
      easyToUnderstand:strategy.evaluationFactors.length ? 75 : 35,
      easyToVerify:Math.min(100,proof*20),
      easyToScore:strategy.evaluationFactors.length ? 75 : 35,
      easyToDefend:Math.min(100,proof*20)
    };
    const competitive = Math.round(Object.values(criteria).reduce((a,b)=>a+b,0)/5);
    return {
      status:competitive>=80?TRUTH.PARTIALLY_VERIFIED:TRUTH.EVIDENCE_NEEDED,
      criteria,
      proposalReadinessScore:Math.round((compliance.compliancePercent + Math.min(100,proof*20))/2),
      complianceScore:compliance.compliancePercent,
      competitiveStrengthScore:competitive,
      issues:Object.entries(criteria).filter(([,v])=>v<70).map(([k,v])=>({area:k,score:v,status:TRUTH.EVIDENCE_NEEDED}))
    };
  }

  finalQa(input,solicitation,qualificationResult,compliance,review){
    const materialAttestation = input.attestation?.clientAttested === true;
    const noCriticalGaps = qualificationResult.proposalAuthorized && compliance.compliancePercent === 100 && review.issues.length === 0;
    return {
      status:noCriticalGaps && materialAttestation ? TRUTH.PARTIALLY_VERIFIED : TRUTH.EVIDENCE_NEEDED,
      clientAttestation:materialAttestation ? TRUTH.VERIFIED : TRUTH.CLIENT_INPUT_REQUIRED,
      contradictions:arr(input.contradictions),
      exactPageLimitsVerified:input.exactPageLimitsVerified === true ? TRUTH.VERIFIED : TRUTH.CLIENT_INPUT_REQUIRED,
      controllingVersionVerified:solicitation.status === TRUTH.VERIFIED ? TRUTH.VERIFIED : TRUTH.NEEDS_INTERPRETATION,
      cleanRoomReviewRequired:true
    };
  }

  packaging(input,solicitation,qa){
    const files = arr(input.submissionFiles).map(f=>({name:text(f?.name)||TRUTH.UNKNOWN,sha256:text(f?.sha256)||TRUTH.EVIDENCE_NEEDED,source:text(f?.source)||TRUTH.UNKNOWN,verified:f?.verified===true}));
    const filesVerified = files.length>0 && files.every(f=>f.verified && f.sha256!==TRUTH.EVIDENCE_NEEDED);
    const kevinApproved = input.kevinApproval?.approved === true;
    const ready = qa.status===TRUTH.PARTIALLY_VERIFIED && filesVerified && kevinApproved;
    return {
      status:filesVerified?TRUTH.PARTIALLY_VERIFIED:TRUTH.EVIDENCE_NEEDED,
      files,
      submissionReadiness:ready?'READY FOR SUBMISSION':'NOT READY FOR SUBMISSION',
      kevinApproval:kevinApproved?TRUTH.VERIFIED:'READY FOR KEVIN APPROVAL',
      submitted:false,
      submissionProof:null,
      rule:'Never mark SUBMITTED without actual external submission proof and frozen exact submitted files.'
    };
  }

  run(input={}){
    const solicitation = this.solicitationIntelligence(input);
    const qualificationResult = this.qualify(input,solicitation);
    const evidence = this.evidenceVault(input);
    const compliance = this.complianceMatrix(solicitation,evidence);
    const strategy = this.strategy(solicitation,qualificationResult,compliance,evidence);
    const production = this.proposalProduction(solicitation,compliance,evidence);
    const review = this.evaluatorReview(compliance,evidence,strategy);
    const qa = this.finalQa(input,solicitation,qualificationResult,compliance,review);
    const packaging = this.packaging(input,solicitation,qa);

    const stages = [
      stage('Solicitation Intelligence',solicitation.status,{evidence:'solicitation'}),
      stage('Qualification',qualificationResult.status,{decision:qualificationResult.decision}),
      stage('Requirements',solicitation.mandatoryRequirements.length||solicitation.sectionL.length?TRUTH.PARTIALLY_VERIFIED:TRUTH.CLIENT_INPUT_REQUIRED),
      stage('Client Evidence',evidence.status),stage('Compliance',compliance.status),stage('Proposal Strategy',strategy.status),
      stage('Proposal Production',production.status),stage('Evaluator Review',review.status),
      stage('Correction',review.issues.length?TRUTH.EVIDENCE_NEEDED:TRUTH.NOT_APPLICABLE),stage('Final QA',qa.status),
      stage('Submission Packaging',packaging.status),stage('Submission Readiness',packaging.submissionReadiness),
      stage('Post-Submission Learning',TRUTH.NOT_APPLICABLE)
    ];

    const report = {
      ok:true,
      product:'P2GC Proposal Command™',
      descriptor:'Government Proposal Intelligence & Submission Platform',
      tagline:'From Solicitation to Submission.',
      generatedAt:now(),
      pipeline:PIPELINE,
      sequence:'Qualify → Understand → Extract → Verify → Comply → Prove → Position → Write → Evaluate → Repair → Validate → Package → Approve → Submit',
      stages,
      solicitation,qualification:qualificationResult,evidenceVault:evidence,compliance,strategy,production,evaluatorReview:review,finalQA:qa,submissionPackage:packaging,
      truthStates:Object.values(TRUTH),
      protections:{noFabrication:true,noPlaceholderText:true,noAutomaticSubmission:true,externalSubmissionEnabled:false,clientAttestationRequired:true,kevinFinalApprovalRequired:true},
      acceptance:{productionAccepted:false,reason:'Requires one real client + one real Government solicitation through the full controlled pipeline and actual submission proof.'}
    };

    fs.mkdirSync(this.outputDir,{recursive:true});
    const name = `${slug(solicitation.solicitationId || solicitation.title || 'proposal')}_${Date.now()}.json`;
    report.evidenceFile = path.join(this.outputDir,name);
    fs.writeFileSync(report.evidenceFile,JSON.stringify(report,null,2),'utf8');
    fs.writeFileSync(path.join(this.outputDir,'latest.json'),JSON.stringify(report,null,2),'utf8');
    return report;
  }

  healthCheck(){
    return {ok:true,status:'HEALTHY',service:'P2GC_PROPOSAL_COMMAND',product:'P2GC Proposal Command™',pipeline:PIPELINE,externalSubmissionEnabled:false,generatedAt:now()};
  }
}

module.exports = P2GCProposalCommandService;
module.exports.TRUTH = TRUTH;
module.exports.PIPELINE = PIPELINE;
