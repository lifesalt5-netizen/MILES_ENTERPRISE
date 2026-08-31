'use strict';
const path=require('path');
const Service=require('../SERVICES/orion/SamCurrentSendCollisionAuditService');
async function main(){const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));const result=await new Service({rootDir}).run();process.exitCode=result.ok?0:2;}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({ok:false,service:'SAM_CURRENT_SEND_COLLISION_AUDIT',error:e.message},null,2));process.exitCode=2;});
