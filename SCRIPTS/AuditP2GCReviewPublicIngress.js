'use strict';

require('dotenv').config({quiet:true});
const {spawnSync}=require('child_process');
const fs=require('fs');
const path=require('path');
const http=require('http');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'DATA','operational_acceptance','latest_p2gc_review_public_ingress_audit.json');
const PORT=Number(process.env.P2GC_CUSTOMER_PORT||8792);

function run(cmd,args=[],timeout=20000){
  try{const r=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout});return{ok:r.status===0,status:r.status,stdout:String(r.stdout||'').trim().slice(0,20000),stderr:String(r.stderr||'').trim().slice(0,8000),error:r.error?.message||null};}
  catch(error){return{ok:false,error:error.message};}
}
function where(name){return process.platform==='win32'?run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','where',name],10000):run('which',[name],10000);}
function httpProbe(){return new Promise(resolve=>{const req=http.get({host:'127.0.0.1',port:PORT,path:'/review/P2GC-FGR-INGRESS-PROBE',timeout:8000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({ok:res.statusCode===200,statusCode:res.statusCode,cacheControl:res.headers['cache-control']||null,xRobotsTag:res.headers['x-robots-tag']||null,bodyMarker:/Personalized Federal Growth Review/i.test(Buffer.concat(chunks).toString('utf8'))}));});req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));req.on('error',e=>resolve({ok:false,error:e.message}));});}
function parseJson(text){try{return JSON.parse(String(text||''));}catch{return null;}}

async function main(){
  const publicBase=String(process.env.P2GC_PUBLIC_REVIEW_BASE_URL||process.env.P2GC_REVIEW_PUBLIC_BASE_URL||'').trim();
  const tailscaleWhere=where('tailscale');
  const tailscaleExeWhere=process.platform==='win32'?where('tailscale.exe'):tailscaleWhere;
  const cli=tailscaleWhere.ok?'tailscale':tailscaleExeWhere.ok?'tailscale.exe':null;
  const status=cli?run(cli,['status','--json'],20000):{ok:false,status:'TAILSCALE_NOT_FOUND'};
  const serve=cli?run(cli,['serve','status','--json'],20000):{ok:false,status:'TAILSCALE_NOT_FOUND'};
  const funnel=cli?run(cli,['funnel','status','--json'],20000):{ok:false,status:'TAILSCALE_NOT_FOUND'};
  const backend=await httpProbe();
  const statusJson=parseJson(status.stdout);const serveJson=parseJson(serve.stdout);const funnelJson=parseJson(funnel.stdout);
  const publicHttpsConfigured=/^https:\/\//i.test(publicBase);
  const funnelText=`${funnel.stdout||''} ${funnel.stderr||''}`;
  const serveText=`${serve.stdout||''} ${serve.stderr||''}`;
  const funnelActive=funnel.ok&&(/https:\/\//i.test(funnelText)||Boolean(funnelJson&&Object.keys(funnelJson).length));
  const serveActive=serve.ok&&(/https:\/\//i.test(serveText)||Boolean(serveJson&&Object.keys(serveJson).length));
  const result={
    ok:true,
    service:'P2GC_REVIEW_PUBLIC_INGRESS_AUDIT',
    observedAt:new Date().toISOString(),
    publicBaseUrl:{configured:Boolean(publicBase),https:publicHttpsConfigured,value:publicBase||null},
    backend,
    tailscale:{cliAvailable:Boolean(cli),path:tailscaleWhere.stdout||tailscaleExeWhere.stdout||null,status:{ok:status.ok,json:statusJson,stdout:statusJson?null:status.stdout,stderr:status.stderr},serve:{ok:serve.ok,active:serveActive,json:serveJson,stdout:serveJson?null:serve.stdout,stderr:serve.stderr},funnel:{ok:funnel.ok,active:funnelActive,json:funnelJson,stdout:funnelJson?null:funnel.stdout,stderr:funnel.stderr}},
    conclusion:publicHttpsConfigured?'PUBLIC_HTTPS_BASE_CONFIGURED':funnelActive?'TAILSCALE_FUNNEL_PRESENT_REVIEW_ROUTE_NOT_YET_PROVEN':serveActive?'TAILSCALE_SERVE_PRESENT_PRIVATE_ONLY':'NO_PUBLIC_INGRESS_PROVEN',
    safety:{readOnly:true,networkChanged:false,dnsChanged:false,funnelChanged:false,serveChanged:false,publicExposureCreated:false}
  };
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exit(2);});
