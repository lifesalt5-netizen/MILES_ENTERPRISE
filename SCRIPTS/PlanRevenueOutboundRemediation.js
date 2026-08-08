"use strict";
const Service=require("../SERVICES/revenue/RevenueOutboundRemediationPlanService");
function parseArguments(argv){return{apply:argv.includes("--apply")};}
function main(){const input=parseArguments(process.argv.slice(2));const report=new Service().build(input);console.log(JSON.stringify(report,null,2));if(!input.apply)console.log("\nPLAN ONLY. Re-run with --apply to persist the internal remediation plan. No Instantly changes, sends, or launches occur.");}
if(require.main===module){try{main();}catch(error){console.error(error.stack||error.message);process.exitCode=1;}}
module.exports={main,parseArguments};
