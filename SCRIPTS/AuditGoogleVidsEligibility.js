'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const accountManager = require('../CONNECTORS/GOOGLE/account_manager');

const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, 'DATA', 'browser', 'profiles', 'miles-chrome');
const OUT = path.join(ROOT, 'DATA', 'operational_acceptance', 'latest_google_vids_eligibility_audit.json');

function lower(v){ return String(v == null ? '' : v).toLowerCase(); }
function hasAny(text, terms){ const t=lower(text); return terms.some(x=>t.includes(lower(x))); }
function emailFrom(text){ const m=String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0].toLowerCase() : null; }

async function inspectSlot(page,slot){
  await page.goto(`https://docs.google.com/videos/u/${slot}/`, { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(3000);
  const url=page.url();
  const title=await page.title().catch(()=> '');
  const body=await page.locator('body').innerText({timeout:10000}).catch(()=> '');
  const aria=await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean).filter(x=>/@|google account/i.test(x)).slice(0,40)).catch(()=>[]);
  const accountHint=[...aria.map(emailFrom),emailFrom(body)].find(Boolean)||null;
  const signInRequired=/accounts\.google\.com|signin/i.test(url)||hasAny(body,['Sign in','Choose an account']);
  const vidsVisible=hasAny(body,['Google Vids','Create a video','New video','Start a new video','Create new']);
  const avatarVisible=hasAny(body,['AI avatar','AI avatars','Avatars','Generate with AI','Help me create','Video generation']);
  const accessBlocked=hasAny(body,['You don’t have access','You do not have access','not available for your account','contact your administrator']);
  return {slot,accountHint,url,title,signInRequired,vidsVisible,avatarVisible,accessBlocked,status:accessBlocked?'ACCESS_BLOCKED':signInRequired?'AUTH_REQUIRED':vidsVisible?(avatarVisible?'VIDS_AI_AVATAR_VISIBLE':'VIDS_VISIBLE_AVATAR_NOT_PROVEN'):'VIDS_NOT_CONFIRMED',textPreview:body.slice(0,900)};
}

async function main(){
  const accounts=await accountManager.healthCheckAccounts().catch(error=>[{status:'ERROR',error:error.message}]);
  const pathwaysAccounts=accounts.filter(a=>/@pathways/i.test(String(a.email||'')));
  const sessions=[];
  let context;
  try{
    context=await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,channel:'chrome',viewport:{width:1440,height:1000},args:['--disable-blink-features=AutomationControlled']});
    const page=context.pages()[0]||await context.newPage();
    for(let slot=0;slot<12;slot++){
      try{ sessions.push(await inspectSlot(page,slot)); }
      catch(error){ sessions.push({slot,status:'AUDIT_ERROR',error:error.message}); }
    }
  }finally{ try{await context?.close();}catch{} }

  const active=sessions.filter(s=>s.vidsVisible===true&&!s.signInRequired&&!s.accessBlocked);
  const pathwaysSessions=active.filter(s=>/@pathways/i.test(String(s.accountHint||'')));
  const avatarSessions=active.filter(s=>s.avatarVisible===true);
  const pathwaysAvatarSessions=pathwaysSessions.filter(s=>s.avatarVisible===true);
  const result={
    ok:active.length>0,
    service:'GOOGLE_VIDS_ELIGIBILITY_AUDIT',
    observedAt:new Date().toISOString(),
    accounts:accounts.map(a=>({email:a.email||null,accountKey:a.accountKey||null,status:a.status||null,error:a.error||null})),
    pathwaysAccounts:pathwaysAccounts.map(a=>({email:a.email,status:a.status})),
    browserSessions:sessions,
    summary:{activeVidsSessions:active.length,pathwaysVidsSessions:pathwaysSessions.length,avatarVisibleSessions:avatarSessions.length,pathwaysAvatarVisibleSessions:pathwaysAvatarSessions.length,pathwaysSessionEmails:[...new Set(pathwaysSessions.map(s=>s.accountHint).filter(Boolean))]},
    status:pathwaysAvatarSessions.length?'PATHWAYS_GOOGLE_VIDS_AI_AVATAR_PROVEN':pathwaysSessions.length?'PATHWAYS_GOOGLE_VIDS_ACCESS_PROVEN_AVATAR_NOT_PROVEN':avatarSessions.length?'GOOGLE_VIDS_AI_AVATAR_PROVEN_NON_PATHWAYS_SESSION':'GOOGLE_VIDS_ACCESS_PROVEN_AVATAR_NOT_PROVEN',
    safety:{readOnly:true,videoGenerated:false,subscriptionChanged:false,accountChanged:false,emailSent:false}
  };
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify(result,null,2));
  process.exitCode=result.ok?0:2;
}

if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=2;});
module.exports={main};
