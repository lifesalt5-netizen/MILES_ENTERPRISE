"use strict";

const fs=require("fs");
const path=require("path");
const {spawnSync}=require("child_process");

const root=process.env.MILES_ROOT || path.resolve(__dirname,"..");
const node=process.execPath;
const steps=[];

function run(label,args){
  const r=spawnSync(node,args,{cwd:root,encoding:"utf8",env:{...process.env,MILES_ROOT:root}});
  steps.push({label,status:r.status,stdout:(r.stdout||"").trim(),stderr:(r.stderr||"").trim()});
  if(r.status!==0) throw new Error(`${label}_FAILED`);
}

try{
  run("SYNTAX_SERVICE",["--check",path.join(root,"SERVICES","monica","MonicaAcquisitionIntelligenceService.js")]);
  run("SYNTAX_REGISTER",["--check",path.join(root,"SCRIPTS","RegisterMonicaTwin.js")]);
  run("SYNTAX_RUNNER",["--check",path.join(root,"SCRIPTS","RunMonicaNetNewAcquisitionCensus.js")]);
  run("SYNTAX_WORKFORCE_TEST",["--check",path.join(root,"TESTS","Test_MonicaWorkforceIntegration.js")]);
  run("UNIT_TEST",[path.join(root,"TESTS","Test_MonicaAcquisitionIntelligence.js")]);
  run("REGISTER_WORKFORCE",[path.join(root,"SCRIPTS","RegisterMonicaTwin.js")]);
  run("WORKFORCE_INTEGRATION",[path.join(root,"TESTS","Test_MonicaWorkforceIntegration.js")]);
  if(!process.argv.includes("--no-census")) run("RUN_CENSUS",[path.join(root,"SCRIPTS","RunMonicaNetNewAcquisitionCensus.js")]);
  const outDir=path.join(root,"DATA","MONICA","INSTALL_ACCEPTANCE");
  fs.mkdirSync(outDir,{recursive:true});
  const evidence={ok:true,twin:"MONICA",mode:"DISCOVERY_ONLY",activationBlocked:true,installedAt:new Date().toISOString(),root,steps};
  fs.writeFileSync(path.join(outDir,"MONICA_INSTALL_ACCEPTANCE.json"),JSON.stringify(evidence,null,2)+"\n","utf8");
  console.log(JSON.stringify({ok:true,twin:"MONICA",mode:"DISCOVERY_ONLY",activationBlocked:true,acceptance:path.join(outDir,"MONICA_INSTALL_ACCEPTANCE.json")},null,2));
}catch(err){
  console.error(JSON.stringify({ok:false,error:err.message,steps},null,2));
  process.exit(1);
}
