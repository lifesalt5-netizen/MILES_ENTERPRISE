'use strict';

require('dotenv').config({ quiet:true });
const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright');

const ROOT=path.resolve(__dirname,'..');
const PROFILE_DIR=path.join(ROOT,'DATA','browser','profiles','miles-chrome');
const OUT=path.join(ROOT,'DATA','operational_acceptance','latest_google_vids_editor_avatar_audit.json');

function low(v){return String(v==null?'':v).toLowerCase();}
function hasAny(text,terms){const t=low(text);return terms.some(x=>t.includes(low(x)));}
function emailFrom(text){const m=String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);return m?m[0].toLowerCase():null;}
async function accountHint(page){const aria=await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean).filter(x=>/@|google account/i.test(x)).slice(0,60)).catch(()=>[]);return [...aria.map(emailFrom)].find(Boolean)||null;}
async function clickableSnapshot(page){return page.locator('button,a,[role="button"],[role="menuitem"]').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,text:(n.innerText||n.textContent||'').trim().replace(/\s+/g,' ').slice(0,180),aria:n.getAttribute('aria-label'),href:n.getAttribute('href'),role:n.getAttribute('role')})).filter(x=>x.text||x.aria).slice(0,250)).catch(()=>[]);}
async function clickFirstVisible(page,patterns){for(const pattern of patterns){for(const candidate of [page.getByRole('button',{name:pattern}).first(),page.getByRole('link',{name:pattern}).first(),page.getByRole('menuitem',{name:pattern}).first(),page.locator('button,a,[role="button"],[role="menuitem"]').filter({hasText:pattern}).first()]){try{if(await candidate.count()&&await candidate.isVisible({timeout:1200})){await candidate.click({timeout:10000});return true;}}catch{}}}return false;}
async function resolveActivePage(context,current){await new Promise(r=>setTimeout(r,1200));const pages=context.pages().filter(p=>!p.isClosed());const candidates=pages.filter(p=>p!==current);for(const p of candidates.reverse()){try{await p.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});const u=p.url();if(/docs\.google\.com\/(?:videos|flix)\//i.test(u))return p;}catch{}}return current;}

async function main(){
  let context;
  const result={ok:false,service:'GOOGLE_VIDS_EDITOR_AVATAR_ELIGIBILITY_AUDIT',observedAt:new Date().toISOString(),selected:null,editor:null,navigation:{},safety:{blankDraftMayBeCreated:true,avatarGenerated:false,videoGenerated:false,shared:false,emailSent:false,subscriptionChanged:false,paidAction:false}};
  try{
    context=await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,channel:'chrome',viewport:{width:1440,height:1000},args:['--disable-blink-features=AutomationControlled']});
    let page=context.pages()[0]||await context.newPage();
    let selected=null;
    for(let slot=0;slot<12;slot++){
      await page.goto(`https://docs.google.com/videos/u/${slot}/`,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(2200);
      const body=await page.locator('body').innerText({timeout:10000}).catch(()=>'');const hint=await accountHint(page);
      if(hint&&/@pathways(?:gsa|gov|govcon|federal|togc|2gc\.co)/i.test(hint)&&hasAny(body,['Start a new video','Create new video','Create a new video','New video'])){selected={slot,email:hint};break;}
    }
    if(!selected){result.status='NO_PATHWAYS_VIDS_SESSION_FOUND';}
    else{
      result.selected=selected;await page.goto(`https://docs.google.com/videos/u/${selected.slot}/`,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(2200);
      result.navigation.before=await clickableSnapshot(page);
      const prePages=context.pages().length;
      const clickedStart=await clickFirstVisible(page,[/^Create new video$/i,/Start a new video/i,/Create a new video/i,/New video/i]);
      result.navigation.clickedStart=clickedStart;await page.waitForTimeout(1400);
      page=await resolveActivePage(context,page);result.navigation.newPageOpened=context.pages().length>prePages;result.navigation.activeUrlAfterStart=page.url();
      const bodyAfterStart=await page.locator('body').innerText({timeout:10000}).catch(()=>'');
      let clickedBlank=false;
      if(hasAny(bodyAfterStart,['Blank video','Create blank','Blank'])){const count=context.pages().length;clickedBlank=await clickFirstVisible(page,[/^Blank video$/i,/^Blank$/i,/Create blank/i]);await page.waitForTimeout(1800);page=await resolveActivePage(context,page);result.navigation.blankOpenedNewPage=context.pages().length>count;}
      result.navigation.clickedBlank=clickedBlank;await page.waitForTimeout(5000);
      const url=page.url();const title=await page.title().catch(()=>'');const body=await page.locator('body').innerText({timeout:15000}).catch(()=>'');const labels=await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean).slice(0,350)).catch(()=>[]);const clickables=await clickableSnapshot(page);const combined=[body,...labels,...clickables.flatMap(x=>[x.text,x.aria])].join('\n');
      const editorVisible=/\/videos\/d\/|\/presentation\/d\/|\/flix\/d\//i.test(url)||hasAny(combined,['Scene','Timeline','Insert media','Add scene','Record yourself','Voiceover']);
      const avatarVisible=hasAny(combined,['AI avatar','AI avatars','Generate avatar','Avatar']);const generateVisible=hasAny(combined,['Generate','Generate with AI','Help me create']);const accessBlocked=hasAny(combined,['You don’t have access','not available for your account','contact your administrator']);
      result.editor={url,title,editorVisible,avatarVisible,generateVisible,accessBlocked,textPreview:body.slice(0,6000),matchingLabels:labels.filter(x=>/avatar|generate|insert|ai|voice|scene/i.test(x)).slice(0,120),matchingControls:clickables.filter(x=>/avatar|generate|insert|ai|voice|scene|blank/i.test(`${x.text} ${x.aria}`)).slice(0,120)};
      result.ok=editorVisible&&!accessBlocked;result.status=accessBlocked?'EDITOR_ACCESS_BLOCKED':avatarVisible?'PATHWAYS_GOOGLE_VIDS_AI_AVATAR_PROVEN':editorVisible?'PATHWAYS_GOOGLE_VIDS_EDITOR_PROVEN_AVATAR_NOT_VISIBLE':'VIDS_EDITOR_NOT_REACHED';
    }
  }catch(error){result.status='EDITOR_AUDIT_ERROR';result.error=error.message;}finally{try{await context?.close();}catch{}}
  result.observedAt=new Date().toISOString();fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:2;
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=2;});module.exports={main};
