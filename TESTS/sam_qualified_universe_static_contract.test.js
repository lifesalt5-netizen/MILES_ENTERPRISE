'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const service=fs.readFileSync(path.join(root,'SERVICES','orion','SamQualifiedUniverseBuildService.js'),'utf8');
const policy=JSON.parse(fs.readFileSync(path.join(root,'CONFIG','GOVERNMENT_DATA','sam_lead_eligibility_policy.json'),'utf8'));
for(const needle of ["SAM_PUBLIC_UTF-8_MONTHLY_V2_","ENRICHMENT_REQUIRED","productionDatabaseModified:false","oldSamRetainedForEmailReuse:true","campaignsModified:false","emailsFabricated:false","stagingOnly:true"]){if(!service.includes(needle))throw new Error('missing service contract: '+needle);}
if(policy.requirements?.forProfitConfirmed!==true)throw new Error('for-profit requirement missing');
if(!policy.hardExcludedNaicsPrefixes?.includes('31')||!policy.hardExcludedNaicsPrefixes?.includes('32')||!policy.hardExcludedNaicsPrefixes?.includes('33'))throw new Error('manufacturing exclusion missing');
console.log('SAM_QUALIFIED_UNIVERSE_STATIC_CONTRACT_TEST=PASS');
