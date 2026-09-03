'use strict';

require('dotenv').config();
const fs=require('fs');
const path=require('path');
const browser=require('../CORE/BROWSER/BrowserManager');
const calendly=require('../CONNECTORS/CALENDLY/connector');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'DATA','operational_acceptance','latest_p2gc_calendly_native_reminder_acceptance.json');
const TARGET_EMAIL='kevin@pathways2gc.com';
const TARGET_NAME=/FEDERAL\s+STRATEGY\s+CALL.*PATHWAYS\s+2\s+GOV(?:ERNMENT|'?T)?\s+CONTRACTING/i;

function clean(v){return String(v==null?'':v).trim();}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function write(x){fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(x,null,2),'utf8');console.log(JSON.stringify(x,null,2));return x;}
async function body(page){return clean(await page.locator('body').innerText({timeout:15000}).catch(()=>''));}
async function click(page,re){
  for(const role of ['button','link']){
    const loc=page.getByRole(role,{name:re}).first();
    if(await loc.count().catch(()=>0)){try{await loc.click({timeout:6000});return true;}catch{}}
  }
  const t=page.getByText(re).first();
  if(await t.count().catch(()=>0)){try{await t.click({timeout:6000});return true;}catch{}}
  return false;
}
function has24h(text){return /(24\s*hours?|1\s*day)\s*(before|prior)|remind[^\n]{0,100}(24\s*hours?|1\s*day)|(24\s*hours?|1\s*day)[^\n]{0,100}remind/i.test(text);}
function hasConfirmation(text){return /(calendar invitation|email confirmation|booking confirmation|confirmation email)/i.test(text);}

async function ensureLogin(page){
  let text=await body(page);
  if(!/Log into your Calendly account/i.test(text)) return {ok:true,status:'ALREADY_AUTHENTICATED'};
  if(!await click(page,/Log in with Google/i)) return {ok:false,status:'GOOGLE_LOGIN_CONTROL_NOT_FOUND',preview:text.slice(0,2500)};
  await sleep(1800);
  text=await body(page);
  const url=page.url();
  if(/accounts\.google\.com/i.test(url)){
    const emailLoc=page.getByText(new RegExp(TARGET_EMAIL.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i')).first();
    if(await emailLoc.count().catch(()=>0)){
      try{await emailLoc.click({timeout:6000});}catch{}
      await sleep(2000);
      text=await body(page);
    }
    if(/password|enter your password|verify it.?s you|2-step|use your passkey/i.test(text)){
      return {ok:false,status:'KEVIN_GOOGLE_INTERACTIVE_AUTH_REQUIRED',url:page.url(),preview:text.slice(0,2500)};
    }
    if(/choose an account/i.test(text) && !new RegExp(TARGET_EMAIL,'i').test(text)){
      return {ok:false,status:'KEVIN_GOOGLE_SESSION_NOT_AVAILABLE',url:page.url(),preview:text.slice(0,2500)};
    }
  }
  await sleep(1800);
  text=await body(page);
  if(/Log into your Calendly account/i.test(text) || /accounts\.google\.com/i.test(page.url())) return {ok:false,status:'CALENDLY_GOOGLE_LOGIN_NOT_COMPLETED',url:page.url(),preview:text.slice(0,2500)};
  return {ok:true,status:'GOOGLE_SESSION_AUTHENTICATED',url:page.url()};
}

async function configure(page,eventName){
  await page.goto('https://calendly.com/app/event_types/user/me',{waitUntil:'domcontentloaded',timeout:30000});
  await sleep(1600);
  let text=await body(page);
  if(/Log into your Calendly account/i.test(text)) return {ok:false,status:'CALENDLY_AUTH_LOST',preview:text.slice(0,2500)};
  const event=page.getByText(TARGET_NAME).first();
  if(!(await event.count().catch(()=>0))) return {ok:false,status:'P2GC_EVENT_CARD_NOT_FOUND',url:page.url(),preview:text.slice(0,5000)};
  try{await event.click({timeout:6000});}catch{
    const parent=event.locator('xpath=ancestor::*[self::a or self::button or @role="button"][1]');
    if(await parent.count().catch(()=>0)) await parent.click({timeout:6000}); else return {ok:false,status:'P2GC_EVENT_CARD_NOT_CLICKABLE'};
  }
  await sleep(1400);
  text=await body(page);
  if(!/notification|workflow|reminder/i.test(text)){
    await click(page,/Notifications(?: and workflows)?|Workflows|Reminders & follow up/i);
    await sleep(1000); text=await body(page);
  }
  if(has24h(text) && hasConfirmation(text)) return {ok:true,status:'ALREADY_CONFIGURED',text};
  if(!has24h(text)){
    const added=await click(page,/Add (?:email )?reminder|Create workflow|Add workflow/i);
    if(!added) return {ok:false,status:'ADD_24H_REMINDER_CONTROL_NOT_FOUND',url:page.url(),preview:text.slice(0,6000)};
    await sleep(800);
    await click(page,/Email to invitee|Send email|Email reminder/i);
    const input=page.locator('input[type="number"]').first();
    if(await input.count().catch(()=>0)) await input.fill('24').catch(()=>{});
    const select=page.locator('select').first();
    if(await select.count().catch(()=>0)) await select.selectOption({label:/hour/i}).catch(()=>{});
    else await click(page,/^hours?$/i);
    await click(page,/before event starts|before event|before/i);
    if(!await click(page,/Save|Done|Apply/i)) return {ok:false,status:'SAVE_24H_REMINDER_CONTROL_NOT_FOUND',preview:(await body(page)).slice(0,6000)};
    await sleep(1300); text=await body(page);
  }
  return {ok:has24h(text),status:has24h(text)?'NATIVE_24H_REMINDER_CONFIGURED':'NATIVE_24H_REMINDER_NOT_VERIFIED',text};
}

async function main(){
  let user;
  try{user=await calendly.getCurrentUser();}catch(error){process.exitCode=2;return write({ok:false,status:'CALENDLY_API_NOT_READY',error:error.message,checkedAt:new Date().toISOString()});}
  if(clean(user?.email).toLowerCase()!==TARGET_EMAIL){process.exitCode=2;return write({ok:false,status:'CALENDLY_ACCOUNT_EMAIL_MISMATCH',calendlyEmail:user?.email||null,checkedAt:new Date().toISOString()});}
  let page;
  try{
    await browser.openSystem('calendly-native-reminders','https://calendly.com/app/meetings/user/me',{headless:false});
    page=browser.pages['calendly-native-reminders'];
    await sleep(1200);
    const login=await ensureLogin(page);
    if(!login.ok){process.exitCode=2;return write({...login,ok:false,checkedAt:new Date().toISOString()});}
    const configured=await configure(page);
    const result={
      ok:configured.ok===true,
      status:configured.status,
      calendlyUser:user.email,
      policy:{immediateConfirmation:'CALENDLY_NATIVE',reminder24HoursBefore:'CALENDLY_NATIVE'},
      verified:{immediateConfirmation:configured.ok===true,reminder24HoursBefore:configured.ok===true},
      url:page.url(),
      checkedAt:new Date().toISOString()
    };
    if(!result.ok) process.exitCode=2;
    return write(result);
  }catch(error){process.exitCode=2;return write({ok:false,status:'CALENDLY_NATIVE_CONFIGURATION_ERROR',error:error.stack||error.message,url:page?.url?.()||null,checkedAt:new Date().toISOString()});}
  finally{try{await browser.close();}catch{}}
}

main();
