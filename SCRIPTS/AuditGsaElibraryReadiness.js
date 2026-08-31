'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/GsaElibraryReadinessAuditService');
async function main(){const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));const result=await new Service({rootDir}).run();console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:2;}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'GSA_ELIBRARY_READINESS_AUDIT',error:e.message},null,2));process.exitCode=2;});
