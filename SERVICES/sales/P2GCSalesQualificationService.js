"use strict";

const fs=require("fs");
const path=require("path");
const ROOT=process.env.MILES_ROOT||path.resolve(__dirname,"..","..");
const OUT_DIR=path.join(ROOT,"DATA","sales_qualification");
function now(){return new Date().toISOString();}
function yes(v){return v===true||String(v).toUpperCase()==="PASS"||String(v).toUpperCase()==="YES";}
function arr(v){return Array.isArray(v)?v:[];}
function write(name,value){fs.mkdirSync(OUT_DIR,{recursive:true});const file=path.join(OUT_DIR,name);fs.writeFileSync(file,JSON.stringify(value,null,2),"utf8");return file;}

const DECISIONS={
 GO:{label:"GO",code:"GO"},
 GO_WITH_RISK:{label:"GO WITH RISK",code:"GO_WITH_RISK"},
 TEAMING_REQUIRED:{label:"TEAMING REQUIRED",code:"TEAMING_REQUIRED"},
 NO_GO:{label:"NO-GO",code:"NO_GO"}
};

class P2GCSalesQualificationService{
 qualify(input={}){
   const requirements={
     primeEligibility:yes(input.primeEligibility),
     minimumQualifications:yes(input.minimumQualifications),
     corporateExperience:yes(input.corporateExperience),
     requiredReferences:yes(input.requiredReferences),
     keyPersonnel:yes(input.keyPersonnel),
     securityRequirements:yes(input.securityRequirements),
     vehicleEligibility:yes(input.vehicleEligibility),
     solicitationCompliance:yes(input.solicitationCompliance)
   };
   const mandatoryMissing=Object.entries(requirements).filter(([,v])=>!v).map(([k])=>k);
   const teamingCanMitigate=arr(input.teamingMitigations).length>0;
   let selected=DECISIONS.GO;
   if(mandatoryMissing.length){selected=teamingCanMitigate?DECISIONS.TEAMING_REQUIRED:DECISIONS.NO_GO;}
   else if(input.riskFlags?.length) selected=DECISIONS.GO_WITH_RISK;
   const proposalAuthorized=selected.code==="GO"||selected.code==="GO_WITH_RISK";
   const result={ok:true,status:"QUALIFIED",generatedAt:now(),opportunityId:input.opportunityId||null,title:input.title||null,requirements,mandatoryMissing,riskFlags:arr(input.riskFlags),teamingMitigations:arr(input.teamingMitigations),decision:selected.label,decisionCode:selected.code,primeAllowed:proposalAuthorized,proposalAuthorized,rules:{mandatoryQualificationBeforePrime:true,noUnsupportedExperienceClaims:true,noUnsupportedReferences:true,noAutomaticSubmission:true}};
   result.evidenceFile=write(`qualification_${Date.now()}.json`,result);return result;
 }
 buildProposalPackage(input={}){
   const qualification=input.qualification||this.qualify(input);
   if(!qualification.proposalAuthorized)return{ok:false,status:"BLOCKED_BY_QUALIFICATION",decision:qualification.decision,decisionCode:qualification.decisionCode||null,mandatoryMissing:qualification.mandatoryMissing};
   const packageData={ok:true,status:"DRAFT_READY_FOR_REVIEW",generatedAt:now(),opportunityId:input.opportunityId||qualification.opportunityId||null,title:input.title||qualification.title||null,qualification,volumes:{technical:{status:"DRAFT",sections:arr(input.technicalSections)},management:{status:"DRAFT",sections:arr(input.managementSections)},pastPerformance:{status:"DRAFT",references:arr(input.pastPerformance)},pricing:{status:"DRAFT",assumptions:arr(input.pricingAssumptions)}},complianceMatrix:arr(input.complianceMatrix),submission:{authorized:false,submitted:false,reason:"External submission requires governed review/approval."}};
   packageData.evidenceFile=write(`proposal_package_${Date.now()}.json`,packageData);return packageData;
 }
 healthCheck(){return{ok:true,status:"HEALTHY",service:"P2GC_SALES_QUALIFICATION",generatedAt:now(),capabilities:["GO_NO_GO","QUALIFICATION_GATE","TEAMING_ROUTE","PROPOSAL_PACKAGE_DRAFT","COMPLIANCE_MATRIX"],decisionLabels:Object.values(DECISIONS).map(x=>x.label),externalSubmissionEnabled:false};}
}
module.exports=new P2GCSalesQualificationService();
