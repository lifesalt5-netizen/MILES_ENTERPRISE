const http = require('http');
const child_process = require('child_process');
const path = require('path');
function get(pathname){return new Promise((resolve,reject)=>{http.get({host:'localhost',port:3737,path:pathname,timeout:5000},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b}));}).on('error',reject);});}
(async()=>{
  const child = child_process.spawn(process.execPath, ['StartMiles.js'], {cwd: process.cwd(), stdio: ['ignore','pipe','pipe']});
  await new Promise(r=>setTimeout(r,1200));
  try{
    const status = await get('/api/status');
    const brief = await get('/api/brief');
    if(status.status!==200 || brief.status!==200) throw new Error('API health endpoints failed');
    const s=JSON.parse(status.body), b=JSON.parse(brief.body);
    if(s.build!=='005') throw new Error('Build number mismatch');
    if(!b.overallHealth) throw new Error('Executive brief missing health score');
    console.log('MILES Build 005 healthcheck passed');
    console.log(JSON.stringify({build:s.build,runtime:s.runtime,approvals:s.approvals.length,workforce:s.workforce.length,health:b.overallHealth},null,2));
  } finally { child.kill(); }
})().catch(e=>{console.error(e);process.exit(1);});
