'use strict';

require('dotenv').config({quiet:true});
const fs=require('fs');
const path=require('path');
const {chromium}=require('playwright');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const VideoProvider=require('../SERVICES/revenue/P2GCFederalGrowthReviewVideoProviderService');
const SegmentPlanner=require('../SERVICES/revenue/P2GCGoogleVidsSegmentPlannerService');

const ROOT=path.resolve(__dirname,'..');
const PROFILE_DIR=path.join(ROOT,'DATA','browser','profiles','miles-chrome');
const OUT_DIR=path.join(ROOT,'DATA','operational_acceptance');
const OUT=path.join(OUT_DIR,'latest_p2gc_demo_video_finalization.json');
const REVIEW_DIR=path.join(ROOT,'DATA','federal_growth_reviews');
const SHOT_DIR=path.join(OUT_DIR,'p2gc_demo_video_evidence');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function clean(v){return String(v==null?'':v).trim();}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}}
function writeJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2),'utf8');}
function latestReview(){
  if(!fs.existsSync(REVIEW_DIR))throw new Error('FEDERAL_GROWTH_REVIEW_STATE_DIR_MISSING');
  const rows=fs.readdirSync(REVIEW_DIR).filter(x=>x.toLowerCase().endsWith('.json')).map(name=>{
    const file=path.join(REVIEW_DIR,name);const rec=readJson(file);let mtime=0;try{mtime=fs.statSync(file).mtimeMs;}catch{}
    return {file,rec,mtime};
  }).filter(x=>x.rec&&clean(x.rec.presentation?.script)&&x.rec.stageState?.PERSONALIZED_SCRIPT?.status==='COMPLETE');
  rows.sort((a,b)=>Math.max(Date.parse(b.rec.updatedAt||0)||0,b.mtime)-Math.max(Date.parse(a.rec.updatedAt||0)||0,a.mtime));
  if(!rows.length)throw new Error('NO_PERSONALIZED_REVIEW_READY_FOR_VIDEO');
  return rows[0];
}
async function snapshot(page,label,result){
  fs.mkdirSync(SHOT_DIR,{recursive:true});
  const file=path.join(SHOT_DIR,`${Date.now()}_${label.replace(/[^a-z0-9_-]/gi,'_')}.png`);
  try{await page.screenshot({path:file,fullPage:true});}catch{}
  const body=await page.locator('body').innerText({timeout:10000}).catch(()=>'');
  const controls=await page.locator('button,a,[role="button"],[role="menuitem"],[role="option"],input,textarea,[contenteditable="true"]').evaluateAll(nodes=>nodes.map((n,i)=>({i,tag:n.tagName,text:(n.innerText||n.textContent||'').trim().replace(/\s+/g,' ').slice(0,180),aria:n.getAttribute('aria-label'),placeholder:n.getAttribute('placeholder'),role:n.getAttribute('role')})).filter(x=>x.text||x.aria||x.placeholder).slice(0,300)).catch(()=>[]);
  result.snapshots.push({label,url:page.url(),title:await page.title().catch(()=>''),file,body:body.slice(0,9000),controls});
  writeJson(OUT,result);
}
async function clickAny(page,selectors,timeout=5000){
  for(const selector of selectors){const loc=page.locator(selector).first();if(await loc.count().catch(()=>0)){try{await loc.click({timeout});return {ok:true,selector};}catch{}}}
  return {ok:false,selector:null};
}
async function fillScript(page,text){
  const locators=[
    'textarea',
    '[role="textbox"]',
    '[contenteditable="true"]',
    'input[placeholder*="script" i]',
    'textarea[placeholder*="script" i]'
  ];
  for(const selector of locators){const list=page.locator(selector);const count=await list.count().catch(()=>0);for(let i=0;i<count;i++){const loc=list.nth(i);if(!(await loc.isVisible().catch(()=>false)))continue;try{if(selector.includes('contenteditable')){await loc.click();await page.keyboard.press('Control+A');await page.keyboard.type(text,{delay:1});}else{await loc.fill(text);}return {ok:true,selector,index:i};}catch{}}}
  return {ok:false};
}
async function accountHint(page){const aria=await page.locator('[aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean).slice(0,100)).catch(()=>[]);for(const v of aria){const m=String(v).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);if(m)return m[0].toLowerCase();}return null;}
async function selectPathwaysAccount(page){
  for(let slot=0;slot<12;slot++){
    await page.goto(`https://docs.google.com/videos/u/${slot}/`,{waitUntil:'domcontentloaded',timeout:60000});await sleep(1500);
    const hint=await accountHint(page);if(hint&&/@pathways(?:gsa|gov|govcon|federal|togc|2gc\.co)/i.test(hint))return {slot,email:hint};
  }
  throw new Error('NO_PATHWAYS_GOOGLE_VIDS_SESSION');
}
async function ensureEditor(page,slot){
  await page.goto('https://vids.new',{waitUntil:'domcontentloaded',timeout:60000});await sleep(6000);
  if(/\/videos\/d\//i.test(page.url()))return;
  const landscape=await clickAny(page,['[aria-label="Create a landscape video"]','[role="button"]:has-text("Landscape")','button:has-text("Landscape")','text=Landscape'],8000);
  if(landscape.ok){await sleep(7000);return;}
  await page.goto(`https://docs.google.com/videos/u/${slot}/`,{waitUntil:'domcontentloaded',timeout:60000});await sleep(2500);
  await clickAny(page,['[aria-label*="Create new video" i]','button:has-text("Create new video")','[role="button"]:has-text("Create new video")'],8000);
  await sleep(4500);
  await clickAny(page,['[aria-label="Create a landscape video"]','[role="button"]:has-text("Landscape")','button:has-text("Landscape")','text=Landscape'],8000);
  await sleep(7000);
}
async function addAvatarSegment(page,segment,result){
  const avatar=await clickAny(page,['[aria-label="Generate an avatar"]','[role="button"]:has-text("Avatar")','button:has-text("Avatar")','text=Avatar'],8000);
  if(!avatar.ok)throw new Error(`SEGMENT_${segment.index}_AVATAR_CONTROL_NOT_FOUND`);
  await sleep(1800);await snapshot(page,`segment_${segment.index}_avatar_open`,result);
  await clickAny(page,['[role="button"]:has-text("Have your avatar present")','text=Have your avatar present','[role="button"]:has-text("AI avatar")','text=AI avatar'],6000);
  await sleep(1500);
  const fill=await fillScript(page,segment.text||segment.script);if(!fill.ok)throw new Error(`SEGMENT_${segment.index}_SCRIPT_INPUT_NOT_FOUND`);
  const generate=await clickAny(page,['button:has-text("Generate")','[role="button"]:has-text("Generate")','button:has-text("Create")','[role="button"]:has-text("Create")'],8000);
  if(!generate.ok)throw new Error(`SEGMENT_${segment.index}_GENERATE_CONTROL_NOT_FOUND`);
  const start=Date.now();let done=false;
  while(Date.now()-start<180000){await sleep(4000);const body=await page.locator('body').innerText().catch(()=>'');if(/generated|insert|add to scene|use this|done/i.test(body)&&!/generating|creating/i.test(body)){done=true;break;}}
  await snapshot(page,`segment_${segment.index}_after_generate`,result);
  if(!done)throw new Error(`SEGMENT_${segment.index}_GENERATION_TIMEOUT`);
  await clickAny(page,['button:has-text("Insert")','[role="button"]:has-text("Insert")','button:has-text("Add to scene")','[role="button"]:has-text("Add to scene")','button:has-text("Use this")'],7000);
  result.completedSegments=segment.index;writeJson(OUT,result);
  if(segment.index<result.segmentPlan.segmentCount){await clickAny(page,['[aria-label="New scene (Ctrl+M)"]','[role="button"][aria-label*="New scene" i]','button:has-text("New scene")'],7000);await sleep(1200);}
}
async function exportMp4(page,result){
  await clickAny(page,['text=File','[role="menuitem"]:has-text("File")'],5000);await sleep(800);
  const downloadPromise=page.waitForEvent('download',{timeout:120000}).catch(()=>null);
  const clicked=await clickAny(page,['[role="menuitem"]:has-text("Download")','[role="menuitem"]:has-text("Export")','text=Download','text=Export'],8000);
  if(!clicked.ok)throw new Error('VIDEO_EXPORT_CONTROL_NOT_FOUND');
  const download=await downloadPromise;if(!download)throw new Error('VIDEO_EXPORT_DOWNLOAD_NOT_OBSERVED');
  const suggested=download.suggestedFilename()||`P2GC_Demo_${Date.now()}.mp4`;const targetDir=path.join(ROOT,'DATA','federal_growth_review_media','exports');fs.mkdirSync(targetDir,{recursive:true});const target=path.join(targetDir,suggested.toLowerCase().endsWith('.mp4')?suggested:`${suggested}.mp4`);await download.saveAs(target);if(!fs.existsSync(target)||fs.statSync(target).size<10000)throw new Error('VIDEO_EXPORT_ARTIFACT_INVALID');result.mp4Path=target;result.mp4Bytes=fs.statSync(target).size;return target;
}
async function main(){
  const result={ok:false,status:'STARTED',startedAt:new Date().toISOString(),snapshots:[],completedSegments:0};writeJson(OUT,result);
  let context;
  try{
    const chosen=latestReview();result.reviewId=chosen.rec.reviewId;result.company=chosen.rec.company;result.reviewUpdatedAt=chosen.rec.updatedAt;result.scriptWords=clean(chosen.rec.presentation.script).split(/\s+/).filter(Boolean).length;
    const lifecycle=new Lifecycle({rootDir:ROOT});const provider=new VideoProvider({rootDir:ROOT,lifecycle});const providerReady=provider.prepareReview(result.reviewId);result.providerDecision=providerReady;
    if(providerReady.provider!=='GOOGLE_VIDS')throw new Error(`GOOGLE_VIDS_REQUIRED_CURRENT_PROVIDER_${providerReady.provider||'NONE'}`);
    const planner=new SegmentPlanner({wordsPerMinute:135,maxSeconds:28});const segmentPlan=planner.plan(chosen.rec.presentation);result.segmentPlan=segmentPlan;writeJson(OUT,result);
    context=await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,channel:'chrome',acceptDownloads:true,viewport:{width:1440,height:1000},args:['--disable-blink-features=AutomationControlled']});const page=context.pages()[0]||await context.newPage();const account=await selectPathwaysAccount(page);result.googleAccount=account;await ensureEditor(page,account.slot);await snapshot(page,'editor_ready',result);
    for(const segment of segmentPlan.segments){await addAvatarSegment(page,segment,result);}
    const mp4=await exportMp4(page,result);result.status='MP4_EXPORTED';result.mp4Path=mp4;result.finishedAt=new Date().toISOString();result.ok=true;writeJson(OUT,result);console.log(JSON.stringify(result,null,2));
  }catch(error){result.status='FAILED';result.error=error.message;result.stack=error.stack;result.finishedAt=new Date().toISOString();writeJson(OUT,result);console.error(JSON.stringify(result,null,2));process.exitCode=2;}finally{try{await context?.close();}catch{}}
}
if(require.main===module)main();
module.exports={main};
