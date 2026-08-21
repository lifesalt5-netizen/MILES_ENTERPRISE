"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {MonicaAcquisitionIntelligenceService}=require("../SERVICES/monica/MonicaAcquisitionIntelligenceService");

const root=fs.mkdtempSync(path.join(os.tmpdir(),"monica-contract-"));
fs.mkdirSync(path.join(root,"CONFIG","MONICA"),{recursive:true});
fs.mkdirSync(path.join(root,"DATA","OUTBOUND"),{recursive:true});
fs.mkdirSync(path.join(root,"DATA","marketing_coo"),{recursive:true});
fs.mkdirSync(path.join(root,"DATA","ORION"),{recursive:true});

fs.writeFileSync(path.join(root,"CONFIG","MONICA","monica_acquisition_config.json"),JSON.stringify({
  mode:"DISCOVERY_ONLY",activationBlocked:true,
  candidateRoots:[path.join(root,"DATA","ORION")],
  suppressionRoots:[path.join(root,"DATA","OUTBOUND"),path.join(root,"DATA","marketing_coo")],
  candidatePatterns:["revenue"],suppressionPatterns:["MASTER_DEDUPED_ALL_SEGMENTS","instantly"],
  minNetNewForBuildTest:1,minNetNewForNurture:1,minVerifiedContactCoverageForGo:0.25,
  estimatedInitialSaleValue:0,maxSourceFileBytes:1048576
}),"utf8");

fs.writeFileSync(path.join(root,"DATA","OUTBOUND","MASTER_DEDUPED_ALL_SEGMENTS.csv"),
  "company_name,domain,email\nExisting Co,existing.com,a@existing.com\n","utf8");
fs.writeFileSync(path.join(root,"DATA","marketing_coo","instantly_export.csv"),
  "company_name,domain,email\nInstant Co,instant.com,z@instant.com\n","utf8");
fs.writeFileSync(path.join(root,"DATA","ORION","revenue_signals.csv"),[
  "company_name,domain,email,email_status,prior_ttm_federal_revenue,current_ttm_federal_revenue,total_federal_revenue,top_agency_share,trigger,trigger_date,prime_sub_status,contract_vehicle,contract_number",
  "Existing Co,existing.com,b@existing.com,valid,2000000,1000000,1000000,80%,REVENUE_DECLINE,2026-08-01,PRIME,GSA MAS,ABC1",
  "Net New One,newone.com,c@newone.com,valid,3000000,1500000,1500000,75%,REVENUE_DECLINE,2026-08-01,PRIME,GSA MAS,NEW1",
  "Net New Two,newtwo.com,d@newtwo.com,unknown,4000000,2000000,2000000,72%,REVENUE_DECLINE,2026-08-02,SUBCONTRACTOR,OASIS+,NEW2"
].join("\n"),"utf8");

const result=new MonicaAcquisitionIntelligenceService({rootDir:root}).run();
assert.equal(result.ok,true);
const decline=result.summary.find(x=>x.segment==="FEDERAL_REVENUE_DECLINE");
assert.ok(decline);
assert.equal(decline.raw_qualified_companies,3);
assert.equal(decline.overlap_26k_master,1);
assert.equal(decline.suppressed_companies,1);
assert.equal(decline.true_net_new_companies,2);
assert.equal(decline.net_new_contacts_with_email,2);
assert.equal(decline.net_new_verified_contacts,1);
assert.equal(decline.segment_qualification,"TEST");
assert.equal(decline.recommended_next_action,"DESIGN_SMALL_CONTROLLED_TEST_FOR_MILES_REVIEW");
assert.equal(decline.estimated_commercial_value,null);
assert.equal(decline.commercial_value_status,"CEO_PRICING_ASSUMPTION_NOT_CONFIGURED");
assert.ok(decline.evidence_backed_market_value>=3500000);

const leads=fs.readFileSync(path.join(result.outputDir,"MONICA_NET_NEW_LEADS.csv"),"utf8");
for(const field of ["email_verification_status","trigger","recompete_expiration","prime_sub_status","vehicle_information","suppression_status"]){
  assert.ok(leads.split(/\r?\n/)[0].includes(field),`missing ${field}`);
}
assert.ok(leads.includes("VERIFIED"));
assert.ok(leads.includes("GSA MAS"));
console.log("MONICA_CENSUS_CONTRACT_GREEN");
