'use strict';

require('dotenv').config({quiet:true});
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const {spawnSync}=require('child_process');
const {chromium}=require('playwright');
const Builder=require('../SERVICES/revenue/P2GCFederalGrowthReviewBuilderService');
const Lifecycle=require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');
const VideoProvider=require('../SERVICES/revenue/P2GCFederalGrowthReviewVideoProviderService');

const ROOT=path.resolve(__dirname,'..');
const OUT_DIR=path.join(ROOT,'DATA','revenue','federal_growth_review','internal_demo');
const EVIDENCE=path.join(ROOT,'DATA','operational_acceptance','latest_p2gc_federal_growth_review_real_video.json');
const TERM=String(process.env.P2GC_INTERNAL_DEMO_TERM||'DeLune Corporation').trim();
const RECIPIENT=String(process.env.P2GC_INTERNAL_DEMO_RECIPIENT||'kevin@pathways2gc.com').trim().toLowerCase();
const RECIPIENT_NAME=String(process.env.P2GC_INTERNAL_DEMO_RECIPIENT_NAME||'Kevin Chace').trim();

function writeEvidence(obj){fs.mkdirSync(path.dirname(EVIDENCE),{recursive:true});fs.writeFileSync(EVIDENCE,JSON.stringify(obj,null,2),'utf8');}
function clean(v){return String(v==null?'':v).trim();}
function run(command,args,options={}){const r=spawnSync(command,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,...options});return{ok:r.status===0,status:r.status,stdout:String(r.stdout||''),stderr:String(r.stderr||''),error:r.error?.message||null};}
function escHtml(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sentencePreview(text,max=250){const s=clean(text).replace(/\s+/g,' ');if(s.length<=max)return s;const cut=s.slice(0,max);return `${cut.slice(0,Math.max(cut.lastIndexOf('.'),cut.lastIndexOf(' '),180)).trim()}…`;}
function findExeRecursive(base,names,maxDepth=3,depth=0){if(!base||!fs.existsSync(base)||depth>maxDepth)return null;let entries=[];try{entries=fs.readdirSync(base,{withFileTypes:true});}catch{return null;}for(const e of entries){if(e.isFile()&&names.includes(e.name.toLowerCase()))return path.join(base,e.name);}for(const e of entries){if(e.isDirectory()&&/ffmpeg|playwright|browser/i.test(e.name)){const found=findExeRecursive(path.join(base,e.name),names,maxDepth,depth+1);if(found)return found;}}return null;}
function findFfmpeg(){
  const where=run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','where','ffmpeg']);if(where.ok){const first=where.stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(first&&fs.existsSync(first))return first;}
  const candidates=[process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'ms-playwright'),path.join(ROOT,'node_modules','playwright-core','.local-browsers'),path.join(ROOT,'node_modules','playwright','.local-browsers')].filter(Boolean);
  for(const base of candidates){const found=findExeRecursive(base,['ffmpeg.exe','ffmpeg-win64.exe'],5);if(found)return found;}
  return null;
}
function findFfprobe(ffmpeg){
  const where=run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','where','ffprobe']);if(where.ok){const first=where.stdout.split(/\r?\n/).map(x=>x.trim()).find(Boolean);if(first&&fs.existsSync(first))return first;}
  if(ffmpeg){const guesses=[path.join(path.dirname(ffmpeg),'ffprobe.exe'),ffmpeg.replace(/ffmpeg(?:-win64)?\.exe$/i,'ffprobe.exe')];for(const g of guesses)if(fs.existsSync(g))return g;}
  return null;
}
function wavDuration(wav){const b=fs.readFileSync(wav);if(b.length<44)return 0;let offset=12,rate=0,data=0;while(offset+8<=b.length){const id=b.toString('ascii',offset,offset+4);const size=b.readUInt32LE(offset+4);if(id==='fmt '&&size>=16)rate=b.readUInt32LE(offset+8+8);if(id==='data'){data=size;break;}offset+=8+size+(size%2);}return rate?data/rate:0;}
function speakToWav(text,wav){
  const txt=`${wav}.txt`;fs.writeFileSync(txt,text,'utf8');
  const ps=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=0; $s.Volume=100; $s.SetOutputToWaveFile('${wav.replace(/'/g,"''")}'); $t=[IO.File]::ReadAllText('${txt.replace(/'/g,"''")}'); $s.Speak($t); $s.Dispose()`;
  const r=run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{timeout:240000});try{fs.unlinkSync(txt);}catch{}if(!r.ok||!fs.existsSync(wav))throw new Error(`WINDOWS_TTS_FAILED:${r.stderr.slice(-800)}`);return wavDuration(wav);
}
async function renderSlide(section,index,total,png,company){
  const browser=await chromium.launch({headless:true,channel:'chrome'});try{const page=await browser.newPage({viewport:{width:1920,height:1080}});const title=escHtml(section.title||`Federal Growth Review ${index}`);const body=escHtml(sentencePreview(section.script,430));const progress=Math.round(index/total*100);await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#071426,#10284a 60%,#18365c);font-family:Arial,Helvetica,sans-serif;color:#fff;width:1920px;height:1080px;overflow:hidden}.wrap{padding:86px 110px;height:100%;display:flex;flex-direction:column}.brand{font-size:28px;letter-spacing:2px;font-weight:700;color:#9fd4ff}.rule{width:150px;height:6px;background:#fff;margin:26px 0 56px;border-radius:4px}.company{font-size:28px;color:#c9d9eb;margin-bottom:20px}.title{font-size:66px;line-height:1.05;font-weight:800;max-width:1500px}.body{font-size:35px;line-height:1.42;max-width:1460px;color:#edf5ff;margin-top:50px}.footer{margin-top:auto;display:flex;justify-content:space-between;align-items:center;color:#b7c8dc;font-size:24px}.bar{position:absolute;left:0;bottom:0;height:10px;background:#fff;width:${progress}%}</style></head><body><div class="wrap"><div class="brand">PATHWAYS 2 GOVERNMENT CONTRACTING • P2GC</div><div class="rule"></div><div class="company">Personalized Federal Growth Review • ${escHtml(company)}</div><div class="title">${title}</div><div class="body">${body}</div><div class="footer"><span>Evidence-backed federal growth analysis</span><span>${index} / ${total}</span></div></div><div class="bar"></div></body></html>`,{waitUntil:'load'});await page.screenshot({path:png,type:'png'});}finally{await browser.close();}
}
function encodeSegment(ffmpeg,png,wav,duration,out){const args=['-y','-loop','1','-i',png,'-i',wav,'-c:v','libx264','-tune','stillimage','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','160k','-shortest','-t',String(Math.max(1,duration+0.25).toFixed(2)),out];const r=run(ffmpeg,args,{timeout:300000});if(!r.ok||!fs.existsSync(out))throw new Error(`FFMPEG_SEGMENT_FAILED:${r.stderr.slice(-1200)}`);}
function concatSegments(ffmpeg,segments,out){const list=path.join(path.dirname(out),'concat.txt');fs.writeFileSync(list,segments.map(x=>`file '${x.replace(/'/g,"'\\''")}'`).join('\r\n'),'utf8');let r=run(ffmpeg,['-y','-f','concat','-safe','0','-i',list,'-c','copy',out],{timeout:300000});if(!r.ok||!fs.existsSync(out)){r=run(ffmpeg,['-y','-f','concat','-safe','0','-i',list,'-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p',out],{timeout:300000});}if(!r.ok||!fs.existsSync(out))throw new Error(`FFMPEG_CONCAT_FAILED:${r.stderr.slice(-1200)}`);}
function probeDuration(ffprobe,file){if(ffprobe){const r=run(ffprobe,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);const n=Number(r.stdout.trim());if(r.ok&&Number.isFinite(n)&&n>0)return n;}return null;}
async function main(){
  const evidence={ok:false,status:'P2GC_REAL_DEMO_VIDEO_STARTING',startedAt:new Date().toISOString(),term:TERM,recipient:RECIPIENT,safety:{externalSend:false,paidAction:false,pricingChange:false,dnsChange:false,providerPurchase:false}};writeEvidence(evidence);
  if(process.platform!=='win32')throw new Error('REAL_VIDEO_RENDER_WINDOWS_RUNTIME_REQUIRED');
  fs.mkdirSync(OUT_DIR,{recursive:true});
  const ffmpeg=findFfmpeg();if(!ffmpeg)throw new Error('LOCAL_FFMPEG_NOT_FOUND_IN_PATH_OR_PLAYWRIGHT_RUNTIME');const ffprobe=findFfprobe(ffmpeg);
  evidence.ffmpeg={path:ffmpeg,ffprobe:ffprobe||null};
  const lifecycle=new Lifecycle({rootDir:ROOT});
  const builder=new Builder({rootDir:ROOT,lifecycle,requestTimeoutMs:210000});
  const draft=await builder.createFromAssessment({term:TERM,recipientEmail:RECIPIENT,recipientName:RECIPIENT_NAME,companyDomain:'pathways2gc.com',refresh:true,expirationHours:72});
  let review=lifecycle.read(draft.reviewId);if(!review?.presentation?.script)throw new Error('REAL_VIDEO_PERSONALIZED_SCRIPT_MISSING');
  const sections=Array.isArray(review.presentation.sections)&&review.presentation.sections.length?review.presentation.sections:[{id:'REVIEW',title:'Personalized Federal Growth Review',script:review.presentation.script}];
  const work=path.join(OUT_DIR,`${draft.reviewId}-${Date.now()}`);fs.mkdirSync(work,{recursive:true});
  const segments=[];let narrationSeconds=0;
  for(let i=0;i<sections.length;i++){
    const base=String(i+1).padStart(2,'0');const png=path.join(work,`${base}.png`);const wav=path.join(work,`${base}.wav`);const mp4=path.join(work,`${base}.mp4`);
    await renderSlide(sections[i],i+1,sections.length,png,review.company?.name||TERM);
    const seconds=speakToWav(sections[i].script,wav);narrationSeconds+=seconds;encodeSegment(ffmpeg,png,wav,seconds,mp4);segments.push(mp4);
  }
  const finalPath=path.join(OUT_DIR,`${draft.reviewId}-personalized-federal-growth-review.mp4`);concatSegments(ffmpeg,segments,finalPath);
  const duration=probeDuration(ffprobe,finalPath)||narrationSeconds;
  const mediaId=`p2gc-fgr-${draft.reviewId.toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
  const provider=new VideoProvider({rootDir:ROOT,lifecycle});
  const ready=provider.markVideoReady(draft.reviewId,{provider:'LOCAL_OPEN_SOURCE',mediaId,durationSeconds:Math.round(duration),localArtifactPath:finalPath,renderEvidence:{renderedAt:new Date().toISOString(),providerProjectRef:`LOCAL_RENDER_PIPELINE:${draft.reviewId}`,artifactRef:finalPath,completedSegmentCount:sections.length,verifiedBy:'MILES_REAL_VIDEO_RENDER'}});
  review=lifecycle.read(draft.reviewId);
  const bytes=fs.statSync(finalPath).size;
  const result={ok:true,status:'P2GC_REAL_DEMO_VIDEO_GREEN',finishedAt:new Date().toISOString(),reviewId:draft.reviewId,company:review.company,recipient:review.recipient,findingCount:review.findings?.length||0,sectionCount:sections.length,durationSeconds:Math.round(duration),runtimeTargetStatus:ready.runtimeTargetStatus,mediaId,localArtifactPath:finalPath,bytes,videoStatus:review.presentation?.videoStatus,streamingReady:review.presentation?.streamingReady===true,professionalAiDemoStage:review.stageState?.PROFESSIONAL_AI_DEMO?.status||null,privateMedia:review.presentation?.privateMedia||null,ffmpeg:evidence.ffmpeg,safety:evidence.safety};
  writeEvidence(result);console.log(JSON.stringify(result,null,2));
  if(!(result.streamingReady&&result.professionalAiDemoStage==='COMPLETE'&&result.bytes>10000))process.exitCode=2;
}
main().catch(error=>{const result={ok:false,status:'P2GC_REAL_DEMO_VIDEO_RED',failedAt:new Date().toISOString(),error:error.message,stack:String(error.stack||'').split('\n').slice(0,8),safety:{externalSend:false,paidAction:false,pricingChange:false,dnsChange:false,providerPurchase:false}};writeEvidence(result);console.error(JSON.stringify(result,null,2));process.exitCode=2;});
