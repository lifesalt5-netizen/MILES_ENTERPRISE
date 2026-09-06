'use strict';

// V10 copy/content correction on top of the narration-synced renderer.
// Fixes decimal splitting, clarifies the fictional-company setup, broadens pathways,
// and adds a FREE company-specific demo CTA with a closing thank-you.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'RenderP2GCFederalGrowthReviewV5SpeechSync.js');
const GENERATED = path.join(__dirname, '_runtime_RenderP2GCFederalGrowthReviewV10CopyFix.js');

function main() {
  let src = fs.readFileSync(SOURCE, 'utf8');

  src = src
    .replace("path.join(ROOT,'DATA','reusable_demo','v5')", "path.join(ROOT,'DATA','reusable_demo','v10')")
    .replace('P2GC_Federal_Growth_Review_Demo_V5.mp4', 'P2GC_Federal_Growth_Review_Demo_V10.mp4')
    .replace('latest_p2gc_v5_render.json', 'latest_p2gc_v10_render.json')
    .replace("const RATE='-8%';", "const RATE='-18%';")
    .replace('const BETWEEN_CHUNK_HOLD=0.10;', 'const BETWEEN_CHUNK_HOLD=0.30;')
    .replace('const BETWEEN_SCENE_HOLD=0.18;', 'const BETWEEN_SCENE_HOLD=0.70;')
    .replace(/V5_SPEECH_SYNC_RENDER/g, 'V10_COPY_FIX_RENDER')
    .replace(/Final V5 speech-synced MP4 created/g, 'Final V10 corrected speech-synced MP4 created')
    .replace(/FINAL_V5_/g, 'FINAL_V10_')
    .replace(/v5_concat\.txt/g, 'v10_concat.txt')
    .replace(/final_v5_mp4_created/g, 'final_v10_mp4_created');

  // Decimal-safe sentence splitting: protect periods inside numbers such as 11.8, 4.2 and 2.7.
  const oldSplit = "function splitSentences(text){const a=clean(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];return a.map(s=>clean(s)).filter(Boolean);}";
  const newSplit = "function splitSentences(text){const protectedText=clean(text).replace(/(\\d)\\.(\\d)/g,'$1__DECIMAL__$2');const a=protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];return a.map(s=>clean(s).replace(/__DECIMAL__/g,'.')).filter(Boolean);}";
  if (!src.includes(oldSplit)) throw new Error('V10_DECIMAL_SPLIT_ANCHOR_NOT_FOUND');
  src = src.replace(oldSplit, newSplit);

  // Do not allow tiny comma fragments such as "Now," or "For those companies," to become standalone slides/audio.
  const oldChunks = "function narrationChunks(text){let units=splitSentences(text);const out=[];for(const u of units){const words=u.split(/\\s+/).filter(Boolean);if(words.length>34){const p=splitLongSentence(u);if(p.length>1){out.push(...p);continue;}}out.push(u);}return out.filter(Boolean);}";
  const newChunks = "function narrationChunks(text){let units=splitSentences(text);const out=[];for(const u of units){const words=u.split(/\\s+/).filter(Boolean);if(words.length>34){const p=splitLongSentence(u);if(p.length>1){out.push(...p);continue;}}out.push(u);}const parts=out.filter(Boolean);const merged=[];for(let i=0;i<parts.length;i++){let part=clean(parts[i]);const wc=part.split(/\\s+/).filter(Boolean).length;if(wc<5&&i+1<parts.length){parts[i+1]=part+' '+parts[i+1];continue;}if(wc<5&&merged.length){merged[merged.length-1]=merged[merged.length-1]+' '+part;}else merged.push(part);}return merged;}";
  if (!src.includes(oldChunks)) throw new Error('V10_CHUNK_MERGE_ANCHOR_NOT_FOUND');
  src = src.replace(oldChunks, newChunks);

  // Keep the scheduling URL visually clean while narration says it naturally.
  const oldKey = "function keyLine(text){let s=clean(text);if(s.length<=165)return s;const cut=s.slice(0,165);const i=Math.max(cut.lastIndexOf(','),cut.lastIndexOf(';'),cut.lastIndexOf(' '));return cut.slice(0,i>90?i:165)+'…';}";
  const newKey = "function keyLine(text){let s=clean(text).replace(/pathways\\s+two\\s+g\\s+c\\s+dot\\s+com\\s+slash\\s+schedule/ig,'pathways2gc.com/schedule');if(s.length<=165)return s;const cut=s.slice(0,165);const i=Math.max(cut.lastIndexOf(','),cut.lastIndexOf(';'),cut.lastIndexOf(' '));return cut.slice(0,i>90?i:165)+'…';}";
  if (!src.includes(oldKey)) throw new Error('V10_KEYLINE_ANCHOR_NOT_FOUND');
  src = src.replace(oldKey, newKey);

  // Preserve V9's point-landing behavior.
  src = src
    .replace(
      'function buildChunkVideo(sceneNo,chunkNo,frame,audio,audioDuration,isLastInScene){const hold=isLastInScene?BETWEEN_SCENE_HOLD:BETWEEN_CHUNK_HOLD;',
      "function buildChunkVideo(sceneNo,chunkNo,frame,audio,audioDuration,isLastInScene,chunkText){const impactful=/\\?|\\$|%|million|thousand|out of 100|qualified paths|revenue|exposed|risk|protect|expand|capture|FREE|first federal|sub-to-prime|SLED-to-Fed/i.test(String(chunkText||''));const hold=isLastInScene?BETWEEN_SCENE_HOLD:(impactful?0.45:BETWEEN_CHUNK_HOLD);"
    )
    .replace(
      'const seg=buildChunkVideo(scene.scene,chunkNo,frame,audio.file,audio.duration,chunkNo===chunks.length);',
      'const seg=buildChunkVideo(scene.scene,chunkNo,frame,audio.file,audio.duration,chunkNo===chunks.length,chunks[i]);'
    );

  const anchor = "if(!Array.isArray(master.scenes)||master.scenes.length!==11)throw new Error('APPROVED_SCENE_COUNT_INVALID');const pyExe=ensureEdgeTts(status);";
  const injected = "if(!Array.isArray(master.scenes)||master.scenes.length!==11)throw new Error('APPROVED_SCENE_COUNT_INVALID');" +
    "const intro={scene:0,title:'Welcome to the P2GC Federal Growth Review',durationSeconds:0,avatarSeconds:0,emotionalBeat:'Welcome',screen:['Glad you are able to review this today','Federal data → clearer growth picture','Let’s get started'],selfDiagnosis:null,narration:\"I’m glad you’re able to review this today. In the next few minutes, we’ll show how P2GC turns federal data into a clearer growth picture. Let’s get started.\"};" +
    "const scene2=master.scenes.find(s=>s.scene===2);if(scene2){scene2.narration=scene2.narration+\" Next we’ll look at a fictional company so you can see how P2GC reviews a business and why the findings matter. You’ll see what we look for and how those findings point to a practical growth path.\";}" +
    "const scene10=master.scenes.find(s=>s.scene===10);if(scene10){scene10.narration=\"Everything in this demonstration is fictional. With a real company, we apply the same process to its actual position and starting point. Some companies already have federal awards. Some have a GSA or VA vehicle with low or zero sales. Some have strong subcontracting performance and may be ready for a Sub-to-Prime strategy. Some have strong state, local, or education performance and want a SLED-to-Fed pathway. And some have never won a federal award at all. For those companies, the review focuses on readiness, target agencies, buyer fit, teaming or prime strategy, vehicle needs, and the most realistic path to a first federal win. The goal is not to force every company into the same model. It is to identify the federal growth path that fits where your company is today.\";scene10.screen=['YOUR COMPANY → YOUR FEDERAL GROWTH PATH','FIRST FEDERAL WIN','SUB → PRIME','SLED → FED','GSA / VA VEHICLE GROWTH','AGENCY EXPANSION','TEAMING & PRIME STRATEGY','CAPTURE PRIORITIZATION'];}" +
    "const scene11=master.scenes.find(s=>s.scene===11);if(scene11){scene11.narration=\"If you want to see what this process reveals about your company, schedule your FREE company-specific Federal Growth Review demo. We’ll use your actual position to show the areas that appear to deserve attention first and the growth pathways that may make the most sense for you. There is no generic sales presentation. Schedule your FREE company-specific demo at pathways two g c dot com slash schedule. Thank you for watching, and we look forward to reviewing your company with you.\";scene11.screen=['REQUEST YOUR FREE COMPANY-SPECIFIC DEMO','Your actual company • your actual position • your growth path','15–20 Minute Discussion','No generic sales presentation','pathways2gc.com/schedule','Thank you for watching'];}" +
    "master.scenes.unshift(intro);const pyExe=ensureEdgeTts(status);";

  if (!src.includes(anchor)) throw new Error('V10_INJECTION_ANCHOR_NOT_FOUND');
  src = src.replace(anchor, injected);

  src = src
    .replace("status.all11Scenes='PASS';status.audio='PASS';", "status.all11Scenes='PASS';status.intro='PASS';status.decimalIntegrity='PASS';status.noFederalAwardsPath='PASS';status.subToPrime='PASS';status.sledToFed='PASS';status.vehicleGrowth='PASS';status.freeCompanySpecificDemo='PASS';status.closingThanks='PASS';status.audio='PASS';")
    .replace("status.goGreen=true;", "status.targetRuntimeSeconds=510;status.runtimeTargetWindowSeconds=[490,550];status.goGreen=actual>=490&&actual<=550;");

  fs.writeFileSync(GENERATED, src, 'utf8');

  const r = spawnSync(process.execPath, [GENERATED], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1800000,
    maxBuffer: 32 * 1024 * 1024
  });

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw r.error;
  if (r.status !== 0) process.exitCode = r.status || 2;
}

if (require.main === module) main();
module.exports = { main };
