"use strict";
const svc=require("../SERVICES/sales/P2GCSalesQualificationService");
const checks=[];function add(n,o,d=null){checks.push({name:n,ok:Boolean(o),detail:d});console.log(`[${o?"PASS":"FAIL"}] ${n}${d?` :: ${d}`:""}`)}
const bad=svc.qualify({opportunityId:"NO_GO_TEST",primeEligibility:true,minimumQualifications:true,corporateExperience:false,requiredReferences:false,keyPersonnel:true,securityRequirements:true,vehicleEligibility:true,solicitationCompliance:true});
add("mandatory qualification failure blocks prime",bad.decision==="NO_GO"&&!bad.primeAllowed,bad.decision);
const teaming=svc.qualify({opportunityId:"TEAM_TEST",primeEligibility:true,minimumQualifications:true,corporateExperience:false,requiredReferences:false,keyPersonnel:true,securityRequirements:true,vehicleEligibility:true,solicitationCompliance:true,teamingMitigations:["Qualified prime partner supplies required experience/references"]});
add("qualifications can route to teaming",teaming.decision==="TEAMING_REQUIRED",teaming.decision);
const good=svc.qualify({opportunityId:"GO_TEST",title:"Qualified Opportunity",primeEligibility:true,minimumQualifications:true,corporateExperience:true,requiredReferences:true,keyPersonnel:true,securityRequirements:true,vehicleEligibility:true,solicitationCompliance:true});
add("fully qualified opportunity returns GO",good.decision==="GO"&&good.proposalAuthorized,good.decision);
const proposal=svc.buildProposalPackage({opportunityId:"GO_TEST",title:"Qualified Opportunity",qualification:good,technicalSections:["Approach","Staffing"],managementSections:["Management Plan"],pastPerformance:["Reference 1"],pricingAssumptions:["Labor categories verified"],complianceMatrix:[{requirement:"Section L",status:"MAPPED"}]});
add("proposal package is created only after GO",proposal.ok&&proposal.status==="DRAFT_READY_FOR_REVIEW",proposal.status);
add("proposal submission remains governed",proposal.submission?.authorized===false&&proposal.submission?.submitted===false,proposal.submission?.reason);
const blocked=svc.buildProposalPackage({qualification:bad});add("NO-GO cannot create proposal package",blocked.status==="BLOCKED_BY_QUALIFICATION",blocked.status);
const h=svc.healthCheck();add("sales qualification service healthy",h.ok&&h.externalSubmissionEnabled===false,h.status);
const report={ok:checks.every(x=>x.ok),generatedAt:new Date().toISOString(),checks};console.log(`=== P2GC SALES QUALIFICATION ACCEPTANCE ${report.ok?"PASS":"FAIL"} ===`);process.exitCode=report.ok?0:1;
