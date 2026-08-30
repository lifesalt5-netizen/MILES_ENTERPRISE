'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/FederalSourceReadinessAuditService');
async function main(){const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));const result=await new Service({rootDir}).run();console.log(JSON.stringify(result,null,2));process.exitCode=0;}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'FEDERAL_SOURCE_READINESS_AUDIT',error:e.message},null,2));process.exitCode=2;});
