'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/EmailVerificationReadinessAuditService');
function main(){const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));const result=new Service({rootDir}).run();console.log(JSON.stringify(result,null,2));process.exitCode=0;}
if(require.main===module){try{main();}catch(e){console.error(JSON.stringify({ok:false,service:'EMAIL_VERIFICATION_READINESS_AUDIT',error:e.message},null,2));process.exitCode=2;}}
