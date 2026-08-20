"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {MonicaAcquisitionIntelligenceService,companyKey,ratio}=require("../SERVICES/monica/MonicaAcquisitionIntelligenceService");

assert.equal(companyKey({UEI:"ABC-123"}),"UEI:abc123");
assert.equal(companyKey({email:"x@example.com"}),"DOMAIN:example.com");
assert.equal(ratio("75%"),0.75);
assert.equal(ratio("0.75"),0.75);
assert.equal(ratio("65%"),0.65);

const root=fs.mkdtempSync(path.join(os.tmpdir(),"monica-"));
fs.mkdirSync(path.join(root,"CONFIG","MONICA"),{recursive:true});
fs.mkdirSync(path.join(root,"DATA","OUTBOUND"),{recursive:true});
fs.mkdirSync(path.join(root,"DATA","marketing_coo"),{recursive:true});
fs.mkdirSync(path.join(root,"DATA","ORION"),{recursive:true});

fs.writeFileSync(path.join(root,"CONFIG","MONICA","monica_acquisition_config.json"),JSON.stringify({
  mode:"DISCOVERY_ONLY",activationBlocked:true,
  candidateRoots:[path.join(root,"DATA","ORION")],
  suppressionRoots:[path.join(root,"DATA","OUTBOUND"),path.join(root,"DATA","marketing_coo")],
  candidatePatterns:["revenue","recompete","agency","hiring"],
  suppressionPatterns:["MASTER_DEDUPED_ALL_SEGMENTS","instantly"],
  minNetNewForBuildTest:1,maxSourceFileBytes:1048576
}),"utf8");

fs.writeFileSync(path.join(root,"DATA","OUTBOUND","MASTER_DEDUPED_ALL_SEGMENTS.csv"),
  "company_name,domain,email\nExisting Co,existing.com,a@existing.com\n","utf8");
fs.writeFileSync(path.join(root,"DATA","marketing_coo","instantly_export.csv"),
  "company_name,domain,email\nInstant Co,instant.com,z@instant.com\n","utf8");
fs.writeFileSync(path.join(root,"DATA","ORION","revenue_signals.csv"),[
  "company_name,domain,email,prior_ttm_federal_revenue,current_ttm_federal_revenue,total_federal_revenue,top_agency_share",
  "Existing Co,existing.com,b@existing.com,2000000,1000000,1000000,80%",
  "Instant Co,instant.com,q@instant.com,2000000,1000000,1000000,0.80",
  "New Co,newco.com,c@newco.com,3000000,1500000,1500000,75%",
  "Below Threshold,below.com,d@below.com,3000000,1500000,1500000,65%"
].join("\n"),"utf8");

const result=new MonicaAcquisitionIntelligenceService({rootDir:root}).run();
assert.equal(result.authoritativeNetNew,true);
const decline=result.summary.find(x=>x.segment==="FEDERAL_REVENUE_DECLINE");
assert.equal(decline.raw_qualified_companies,4);
assert.equal(decline.overlap_26k_master,1);
assert.equal(decline.overlap_instantly,1);
assert.equal(decline.true_net_new_companies,2);
assert.equal(decline.authoritative_net_new,"YES");
const concentration=result.summary.find(x=>x.segment==="FEDERAL_AGENCY_CONCENTRATION");
assert.equal(concentration.raw_qualified_companies,3);
assert.equal(concentration.true_net_new_companies,1);
console.log("MONICA_TEST_GREEN");
