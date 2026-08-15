'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=process.cwd();
const files=[
  'SERVICES/digital_coo/MilesCommandCenter.js',
  'SERVICES/digital_coo/public/index.html',
  'SERVICES/digital_coo/public/app.js',
  'SERVICES/digital_coo/public/styles.css'
];
const terms={
  'SERVICES/digital_coo/MilesCommandCenter.js':['const host = new DigitalCOOHost','ExecutiveResponseService','http.createServer','/api/health','/api/command'],
  'SERVICES/digital_coo/public/index.html':['CEO Command','operationSummary','response-panel','refreshButton'],
  'SERVICES/digital_coo/public/app.js':['const elements =','refreshButton','pollOperation','sendCommand'],
  'SERVICES/digital_coo/public/styles.css':['.summary-grid','.response-panel','.command-panel']
};
for(const rel of files){
  const p=path.join(ROOT,rel);
  console.log('\n=== '+rel+' ===');
  if(!fs.existsSync(p)){console.log('MISSING');continue;}
  const text=fs.readFileSync(p,'utf8');
  console.log('bytes='+Buffer.byteLength(text,'utf8'));
  const lines=text.split(/\r?\n/);
  for(const term of terms[rel]){
    const idx=lines.findIndex(l=>l.includes(term));
    console.log(term+' => '+(idx>=0?('line '+(idx+1)):'NOT FOUND'));
    if(idx>=0){
      const a=Math.max(0,idx-3), b=Math.min(lines.length,idx+5);
      for(let i=a;i<b;i++) console.log(String(i+1).padStart(5,' ')+': '+lines[i]);
    }
  }
}
