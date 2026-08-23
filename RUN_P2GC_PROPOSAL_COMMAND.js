'use strict';

const fs = require('fs');
const path = require('path');
const P2GCProposalCommandService = require('./SERVICES/proposal/P2GCProposalCommandService');

function arg(name){ const p=process.argv.find(v=>v.startsWith(`${name}=`)); return p ? p.slice(name.length+1) : null; }
function main(){
  const inputFile = arg('--input');
  if(!inputFile){
    console.error('Usage: node RUN_P2GC_PROPOSAL_COMMAND.js --input=<proposal-intake.json>');
    process.exitCode=2; return;
  }
  const full = path.resolve(inputFile);
  if(!fs.existsSync(full)) throw new Error(`Input file not found: ${full}`);
  const input = JSON.parse(fs.readFileSync(full,'utf8').replace(/^\uFEFF/,''));
  const service = new P2GCProposalCommandService();
  const result = service.run(input);
  console.log(JSON.stringify(result,null,2));
}

try{main();}catch(error){console.error(error.stack||error.message);process.exitCode=1;}
