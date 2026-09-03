'use strict';
const path=require('path');
const IdentityIndex=require('../SERVICES/orion/SamPublicIdentityIndexBuildService');
const QualifiedUniverse=require('../SERVICES/orion/SamQualifiedUniverseBuildService');
async function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  const identity=await new IdentityIndex({rootDir}).run();
  const qualified=await new QualifiedUniverse({rootDir}).run();
  const result={ok:identity?.ok===true&&qualified?.ok===true,service:'SAM_PUBLIC_IDENTITY_AND_QUALIFIED_UNIVERSE_BUILD',generatedAt:new Date().toISOString(),publicIdentity:identity,qualifiedUniverse:qualified,safety:{identitySeparatedFromLeadQualification:true,productionDatabaseModified:false,stagingOnly:true}};
  console.log(JSON.stringify(result,null,2));
  process.exitCode=result.ok?0:2;
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'SAM_PUBLIC_IDENTITY_AND_QUALIFIED_UNIVERSE_BUILD',error:e.message,stack:e.stack},null,2));process.exitCode=2;});
