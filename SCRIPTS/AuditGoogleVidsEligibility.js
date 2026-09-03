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

async function main(){
  const accounts = await accountManager.healthCheckAccounts().catch(error => [{status:'ERROR',error:error.message}]);
  const pathwaysAccounts = accounts.filter(a => /@pathways/i.test(String(a.email || '')));
  let browserResult = { ok:false, status:'NOT_CHECKED' };
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless:true,
      channel:'chrome',
      viewport:{width:1440,height:1000},
      args:['--disable-blink-features=AutomationControlled']
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://vids.google.com/', { waitUntil:'domcontentloaded', timeout:60000 });
    await page.waitForTimeout(5000);
    const url = page.url();
    const title = await page.title().catch(()=> '');
    const body = await page.locator('body').innerText({timeout:10000}).catch(()=> '');
    const signInRequired = /accounts\.google\.com|signin/i.test(url) || hasAny(body,['Sign in','Choose an account']);
    const vidsVisible = hasAny(body,['Google Vids','Create a video','New video','Start a new video','Create new']);
    const avatarVisible = hasAny(body,['AI avatar','Avatars','Generate with AI','Help me create','Video generation']);
    const accessBlocked = hasAny(body,['You don’t have access','You do not have access','not available for your account','contact your administrator']);
    browserResult = {
      ok: !accessBlocked && !signInRequired && vidsVisible,
      status: accessBlocked ? 'GOOGLE_VIDS_ACCESS_BLOCKED' : signInRequired ? 'GOOGLE_VIDS_AUTH_REQUIRED' : vidsVisible ? (avatarVisible ? 'GOOGLE_VIDS_AI_AVATAR_VISIBLE' : 'GOOGLE_VIDS_ACCESS_VISIBLE_AVATAR_NOT_PROVEN') : 'GOOGLE_VIDS_NOT_CONFIRMED',
      url,
      title,
      signInRequired,
      vidsVisible,
      avatarVisible,
      accessBlocked,
      textPreview: body.slice(0,3000)
    };
  } catch(error){
    browserResult = { ok:false, status:'GOOGLE_VIDS_BROWSER_AUDIT_ERROR', error:error.message };
  } finally {
    try { await context?.close(); } catch {}
  }

  const result = {
    ok: browserResult.ok === true,
    service:'GOOGLE_VIDS_ELIGIBILITY_AUDIT',
    observedAt:new Date().toISOString(),
    accounts: accounts.map(a=>({email:a.email||null,accountKey:a.accountKey||null,status:a.status||null,error:a.error||null})),
    pathwaysAccounts: pathwaysAccounts.map(a=>({email:a.email,status:a.status})),
    browser: browserResult,
    safety:{readOnly:true,videoGenerated:false,subscriptionChanged:false,accountChanged:false,emailSent:false}
  };
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify(result,null,2));
  process.exitCode = result.ok ? 0 : 2;
}

if(require.main===module) main().catch(error=>{ console.error(error.stack||error.message); process.exitCode=2; });
module.exports={main};
