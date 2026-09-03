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
async function accountHint(page){const aria=await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean).filter(x=>/@|google account/i.test(x)).slice(0,80)).catch(()=>[]);return [...aria.map(emailFrom)].find(Boolean)||null;}
async function clickableSnapshot(page){return page.locator('button,a,[role="button"],[role="menuitem"],[role="option"]').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,text:(n.innerText||n.textContent||'').trim().replace(/\s+/g,' ').slice(0,220),aria:n.getAttribute('aria-label'),href:n.getAttribute('href'),role:n.getAttribute('role')})).filter(x=>x.text||x.aria).slice(0,420)).catch(()=>[]);}
async function inspect(page){
  const url=page.url();const title=await page.title().catch(()=>'');const body=await page.locator('body').innerText({timeout:15000}).catch(()=>'');const labels=await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean).slice(0,600)).catch(()=>[]);const clickables=await clickableSnapshot(page);const combined=[body,...labels,...clickables.flatMap(x=>[x.text,x.aria])].join('\n');
  const account=await accountHint(page);const startMenuVisible=hasAny(combined,['Landscape','Portrait','Square','Create AI videos','Edit videos','Convert Slides','AI avatar']);const editorVisible=/\/videos\/d\/|\/presentation\/d\/|\/flix\/d\//i.test(url)||hasAny(combined,['Scene','Timeline','Insert media','Add scene','Record yourself','Voiceover']);const avatarVisible=hasAny(combined,['AI avatar','AI avatars','Generate avatar','Avatar']);const generateVisible=hasAny(combined,['Generate','Generate with AI','Help me create','Create AI videos']);const accessBlocked=hasAny(combined,['You don’t have access','not available for your account','contact your administrator']);
  return {url,title,body,labels,clickables,combined,account,startMenuVisible,editorVisible,avatarVisible,generateVisible,accessBlocked};
}
async function clickCreateNewVideo(page){
  const selectors=['[aria-label="Create new video"]','[role="button"][aria-label*="Create new video" i]','button:has-text("Create new video")','[role="button"]:has-text("Create new video")'];
  for(const selector of selectors){const loc=page.locator(selector).first();if(await loc.count().catch(()=>0)){try{await loc.click({timeout:6000});return {clicked:true,selector};}catch{}}}
  return {clicked:false,selector:null};
}
async function clickBlankLandscape(page){
  const candidates=['[role="button"]:has-text("Landscape")','button:has-text("Landscape")','[role="menuitem"]:has-text("Landscape")','text=Landscape'];
  for(const selector of candidates){const loc=page.locator(selector).first();if(await loc.count().catch(()=>0)){try{await loc.click({timeout:6000});return {clicked:true,selector};}catch{}}}
  return {clicked:false,selector:null};
}

async function main(){
  let context;
  const result={ok:false,service:'GOOGLE_VIDS_EDITOR_AVATAR_ELIGIBILITY_AUDIT',observedAt:new Date().toISOString(),selected:null,editor:null,navigation:{entryPoint:'https://vids.new',fallbackUsed:false,createNewClicked:false,blankLandscapeClicked:false},safety:{blankDraftMayBeCreated:true,avatarGenerated:false,videoGenerated:false,shared:false,emailSent:false,subscriptionChanged:false,paidAction:false}};
  try{
    context=await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,channel:'chrome',viewport:{width:1440,height:1000},args:['--disable-blink-features=AutomationControlled']});
    let page=context.pages()[0]||await context.newPage();let selected=null;
    for(let slot=0;slot<12;slot++){
      await page.goto(`https://docs.google.com/videos/u/${slot}/`,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(1800);
      const body=await page.locator('body').innerText({timeout:10000}).catch(()=>'');const hint=await accountHint(page);
      if(hint&&/@pathways(?:gsa|gov|govcon|federal|togc|2gc\.co)/i.test(hint)&&hasAny(body,['Start a new video','Create new video','Create a new video','New video'])){selected={slot,email:hint};break;}
    }
    if(!selected){result.status='NO_PATHWAYS_VIDS_SESSION_FOUND';}
    else{
      result.selected=selected;
      await page.goto('https://vids.new',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(7000);
      let state=await inspect(page);
      if(!state.accessBlocked&&!state.startMenuVisible&&!state.editorVisible){
        result.navigation.fallbackUsed=true;
        await page.goto(`https://docs.google.com/videos/u/${selected.slot}/`,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(2500);
        const create=await clickCreateNewVideo(page);result.navigation.createNewClicked=create.clicked;result.navigation.createNewSelector=create.selector;
        if(create.clicked){await page.waitForTimeout(4000);state=await inspect(page);}
        if(!state.accessBlocked&&state.startMenuVisible&&!state.editorVisible){const blank=await clickBlankLandscape(page);result.navigation.blankLandscapeClicked=blank.clicked;result.navigation.blankLandscapeSelector=blank.selector;if(blank.clicked){await page.waitForTimeout(6500);state=await inspect(page);}}
      }
      result.navigation.finalUrl=state.url;result.navigation.accountHint=state.account;result.navigation.startMenuVisible=state.startMenuVisible;
      result.editor={url:state.url,title:state.title,startMenuVisible:state.startMenuVisible,editorVisible:state.editorVisible,avatarVisible:state.avatarVisible,generateVisible:state.generateVisible,accessBlocked:state.accessBlocked,textPreview:state.body.slice(0,7000),matchingLabels:state.labels.filter(x=>/avatar|generate|insert|ai|voice|scene|portrait|landscape|square/i.test(x)).slice(0,180),matchingControls:state.clickables.filter(x=>/avatar|generate|insert|ai|voice|scene|portrait|landscape|square/i.test(`${x.text} ${x.aria}`)).slice(0,180)};
      result.ok=!state.accessBlocked&&(state.startMenuVisible||state.editorVisible);result.status=state.accessBlocked?'EDITOR_ACCESS_BLOCKED':state.avatarVisible?'PATHWAYS_GOOGLE_VIDS_AI_AVATAR_PROVEN':state.startMenuVisible?'PATHWAYS_GOOGLE_VIDS_START_MENU_PROVEN_AVATAR_NOT_VISIBLE':state.editorVisible?'PATHWAYS_GOOGLE_VIDS_EDITOR_PROVEN_AVATAR_NOT_VISIBLE':'VIDS_EDITOR_NOT_REACHED';
    }
  }catch(error){result.status='EDITOR_AUDIT_ERROR';result.error=error.message;}finally{try{await context?.close();}catch{}}
  result.observedAt=new Date().toISOString();fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:2;
}
if(require.main===module)main().catch(error=>{console.error(error.stack||error.message);process.exitCode=2;});module.exports={main};
