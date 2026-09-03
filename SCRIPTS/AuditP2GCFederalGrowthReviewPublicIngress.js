'use strict';

require('dotenv').config();
const {execFileSync}=require('child_process');

function run(command,args=[]){
  try{return {ok:true,stdout:execFileSync(command,args,{encoding:'utf8',windowsHide:true,timeout:15000,stdio:['ignore','pipe','pipe']}).trim()};}
  catch(error){return {ok:false,error:String(error?.stderr||error?.message||error).slice(0,1000)};}
}
function findTailscale(){
  if(process.platform==='win32'){
    const result=run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','where tailscale.exe']);
    return {installed:result.ok,path:result.ok?result.stdout.split(/\r?\n/)[0]:null};
  }
  const result=run('which',['tailscale']);return {installed:result.ok,path:result.ok?result.stdout:null};
}
function safeStatus(){
  const result=run('tailscale',['status','--json']);
  if(!result.ok)return {ok:false,error:result.error};
  try{
    const j=JSON.parse(result.stdout);
    return {ok:true,backendState:j.BackendState||null,selfDnsName:j.Self?.DNSName||null,selfOnline:j.Self?.Online??null,tailnet:j.CurrentTailnet?.Name||null};
  }catch(error){return {ok:false,error:`TAILSCALE_STATUS_JSON_INVALID:${error.message}`};}
}
function serveStatus(){
  const result=run('tailscale',['serve','status','--json']);
  if(!result.ok)return {ok:false,error:result.error};
  try{
    const j=JSON.parse(result.stdout||'{}');
    const text=JSON.stringify(j);
    return {ok:true,configured:Object.keys(j||{}).length>0,mentions8792:/8792/.test(text),mentionsReview:/review/i.test(text)};
  }catch(error){return {ok:false,error:`TAILSCALE_SERVE_JSON_INVALID:${error.message}`};}
}
function funnelStatus(){
  const result=run('tailscale',['funnel','status','--json']);
  if(!result.ok)return {ok:false,error:result.error};
  try{
    const j=JSON.parse(result.stdout||'{}');
    const text=JSON.stringify(j);
    return {ok:true,configured:Object.keys(j||{}).length>0,mentions8792:/8792/.test(text),mentionsReview:/review/i.test(text)};
  }catch(error){return {ok:false,error:`TAILSCALE_FUNNEL_JSON_INVALID:${error.message}`};}
}

const installed=findTailscale();
const publicBase=String(process.env.P2GC_PUBLIC_REVIEW_BASE_URL||'').trim();
const result={
  ok:true,
  status:'P2GC_REVIEW_PUBLIC_INGRESS_AUDIT_COMPLETE',
  publicReviewBaseUrl:{configured:Boolean(publicBase),https:/^https:\/\//i.test(publicBase),value:publicBase||null},
  tailscale:installed,
  tailscaleStatus:installed.installed?safeStatus():{ok:false,status:'NOT_INSTALLED'},
  serve:installed.installed?serveStatus():{ok:false,status:'NOT_INSTALLED'},
  funnel:installed.installed?funnelStatus():{ok:false,status:'NOT_INSTALLED'},
  currentBackend:{host:'127.0.0.1',port:8792,public:false},
  changedAnything:false,
  checkedAt:new Date().toISOString()
};
console.log(JSON.stringify(result,null,2));
