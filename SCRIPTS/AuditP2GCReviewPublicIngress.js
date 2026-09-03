'use strict';

require('dotenv').config({quiet:true});
const {spawnSync}=require('child_process');
const fs=require('fs');
const path=require('path');
const http=require('http');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'DATA','operational_acceptance','latest_p2gc_review_public_ingress_audit.json');
const PORT=Number(process.env.P2GC_CUSTOMER_PORT||8792);
const FUNNEL_GATEWAY_PORT=8779;

function run(cmd,args=[],timeout=20000){try{const r=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout});return{ok:r.status===0,status:r.status,stdout:String(r.stdout||'').trim().slice(0,20000),stderr:String(r.stderr||'').trim().slice(0,8000),error:r.error?.message||null};}catch(error){return{ok:false,error:error.message};}}
function where(name){return process.platform==='win32'?run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','where',name],10000):run('which',[name],10000);}
function request(port,pathname,timeout=8000){return new Promise(resolve=>{const req=http.get({host:'127.0.0.1',port,path:pathname,timeout},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8');let json=null;try{json=JSON.parse(body);}catch{}resolve({ok:res.statusCode>=200&&res.statusCode<500,statusCode:res.statusCode,headers:{contentType:res.headers['content-type']||null,cacheControl:res.headers['cache-control']||null,xRobotsTag:res.headers['x-robots-tag']||null,server:res.headers.server||null},json,bodyPreview:json?null:body.slice(0,2500),reviewMarker:/Personalized Federal Growth Review/i.test(body)});});});req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));req.on('error',e=>resolve({ok:false,error:e.message}));});}
function parseJson(text){try{return JSON.parse(String(text||''));}catch{return null;}}
function windowsPortOwner(port){if(process.platform!=='win32')return{ok:false,status:'WINDOWS_ONLY'};const ps=`$c=Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){$p=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{port=${port};pid=$c.OwningProcess;process=$p.ProcessName;path=$p.Path} | ConvertTo-Json -Compress}`;const r=run('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],15000);return{...r,json:parseJson(r.stdout)};}

async function main(){
  const publicBase=String(process.env.P2GC_PUBLIC_REVIEW_BASE_URL||process.env.P2GC_REVIEW_PUBLIC_BASE_URL||'').trim();
  const tailscaleWhere=where('tailscale');const tailscaleExeWhere=process.platform==='win32'?where('tailscale.exe'):tailscaleWhere;const cli=tailscaleWhere.ok?'tailscale':tailscaleExeWhere.ok?'tailscale.exe':null;
  const status=cli?run(cli,['status','--json'],20000):{ok:false,status:'TAILSCALE_NOT_FOUND'};const serve=cli?run(cli,['serve','status','--json'],20000):{ok:false,status:'TAILSCALE_NOT_FOUND'};const funnel=cli?run(cli,['funnel','status','--json'],20000):{ok:false,status:'TAILSCALE_NOT_FOUND'};
  const backend=await request(PORT,'/review/P2GC-FGR-INGRESS-PROBE');const backendAdmin=await request(PORT,'/api/admin/review/health');
  const gateway={port:FUNNEL_GATEWAY_PORT,owner:windowsPortOwner(FUNNEL_GATEWAY_PORT),root:await request(FUNNEL_GATEWAY_PORT,'/'),health:await request(FUNNEL_GATEWAY_PORT,'/api/health'),reviewProbe:await request(FUNNEL_GATEWAY_PORT,'/review/P2GC-FGR-INGRESS-PROBE'),reviewHealth:await request(FUNNEL_GATEWAY_PORT,'/api/review/health'),adminProbe:await request(FUNNEL_GATEWAY_PORT,'/api/admin/review/health')};
  const statusJson=parseJson(status.stdout);const serveJson=parseJson(serve.stdout);const funnelJson=parseJson(funnel.stdout);const publicHttpsConfigured=/^https:\/\//i.test(publicBase);const funnelText=`${funnel.stdout||''} ${funnel.stderr||''}`;const serveText=`${serve.stdout||''} ${serve.stderr||''}`;const funnelActive=funnel.ok&&(/https:\/\//i.test(funnelText)||Boolean(funnelJson&&Object.keys(funnelJson).length));const serveActive=serve.ok&&(/https:\/\//i.test(serveText)||Boolean(serveJson&&Object.keys(serveJson).length));
  const gatewayAlreadyRoutesReview=gateway.reviewProbe.statusCode===200&&gateway.reviewProbe.reviewMarker===true;const adminNotExposed=gateway.adminProbe.statusCode===403||gateway.adminProbe.statusCode===404||gateway.adminProbe.ok===false;const localAdminReady=backendAdmin.statusCode===200&&backendAdmin.json?.status==='P2GC_REVIEW_ADMIN_PRIVATE_READY'&&backendAdmin.json?.loopbackOnly===true;const ownerName=String(gateway.owner?.json?.process||'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g,'_').toUpperCase();
  let conclusion='NO_PUBLIC_INGRESS_PROVEN';
  if(publicHttpsConfigured) conclusion='PUBLIC_HTTPS_BASE_CONFIGURED';
  else if(gatewayAlreadyRoutesReview&&funnelActive) conclusion=`FUNNEL_GATEWAY_${ownerName}_ALREADY_ROUTES_REVIEW_ADMIN_${adminNotExposed?'BLOCKED':'EXPOSED'}`;
  else if(funnelActive) conclusion=`FUNNEL_GATEWAY_${ownerName}_REVIEW_ROUTE_NOT_PROVEN_ADMIN_${adminNotExposed?'BLOCKED':'EXPOSED'}_LOCAL_ADMIN_${localAdminReady?'READY':'NOT_READY'}`;
  else if(serveActive) conclusion=`TAILSCALE_SERVE_PRESENT_PRIVATE_ONLY_LOCAL_ADMIN_${localAdminReady?'READY':'NOT_READY'}`;
  const result={ok:true,service:'P2GC_REVIEW_PUBLIC_INGRESS_AUDIT',observedAt:new Date().toISOString(),publicBaseUrl:{configured:Boolean(publicBase),https:publicHttpsConfigured,value:publicBase||null},backend,backendAdmin:{...backendAdmin,privateReady:localAdminReady},gateway:{...gateway,alreadyRoutesReview:gatewayAlreadyRoutesReview,adminNotExposed,ownerName},tailscale:{cliAvailable:Boolean(cli),path:tailscaleWhere.stdout||tailscaleExeWhere.stdout||null,status:{ok:status.ok,json:statusJson,stdout:statusJson?null:status.stdout,stderr:status.stderr},serve:{ok:serve.ok,active:serveActive,json:serveJson,stdout:serveJson?null:serve.stdout,stderr:serve.stderr},funnel:{ok:funnel.ok,active:funnelActive,json:funnelJson,stdout:funnelJson?null:funnel.stdout,stderr:funnel.stderr}},conclusion,safety:{readOnly:true,networkChanged:false,dnsChanged:false,funnelChanged:false,serveChanged:false,publicExposureCreated:false}};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exit(2);});
