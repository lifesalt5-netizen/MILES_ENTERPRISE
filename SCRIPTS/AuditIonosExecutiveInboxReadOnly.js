'use strict';

const path = require('path');

async function main(){
  const rootArg = process.argv.find(v=>v.startsWith('--root='));
  const root = path.resolve(rootArg ? rootArg.slice(7) : process.env.MILES_ROOT || path.resolve(__dirname,'..'));
  process.env.MILES_ROOT = root;
  const IonosExecutiveTriageService = require(path.join(root,'SERVICES','revenue','IonosExecutiveTriageService.js'));
  const service = new IonosExecutiveTriageService({root});
  const result = await service.run({execute:false});
  console.log(JSON.stringify(result,null,2));
  if(!result.ok) process.exitCode = 2;
}

main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
