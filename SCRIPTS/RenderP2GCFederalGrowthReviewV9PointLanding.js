'use strict';

// V9 pacing correction: preserve V7 voice/content/sync, but let every spoken point land.
// Normal statements receive a short hold, major metrics/questions a longer hold,
// and topic endings the longest beat. The matching visual remains on screen throughout.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'RenderP2GCFederalGrowthReviewV5SpeechSync.js');
const GENERATED = path.join(__dirname, '_runtime_RenderP2GCFederalGrowthReviewV9PointLanding.js');

function main() {
  let src = fs.readFileSync(SOURCE, 'utf8');

  src = src
    .replace("path.join(ROOT,'DATA','reusable_demo','v5')", "path.join(ROOT,'DATA','reusable_demo','v9')")
    .replace('P2GC_Federal_Growth_Review_Demo_V5.mp4', 'P2GC_Federal_Growth_Review_Demo_V9.mp4')
    .replace('latest_p2gc_v5_render.json', 'latest_p2gc_v9_render.json')
    .replace("const RATE='-8%';", "const RATE='-18%';")
    .replace('const BETWEEN_CHUNK_HOLD=0.10;', 'const BETWEEN_CHUNK_HOLD=0.30;')
    .replace('const BETWEEN_SCENE_HOLD=0.18;', 'const BETWEEN_SCENE_HOLD=0.70;')
    .replace(/V5_SPEECH_SYNC_RENDER/g, 'V9_POINT_LANDING_RENDER')
    .replace(/Final V5 speech-synced MP4 created/g, 'Final V9 point-landing speech-synced MP4 created')
    .replace(/FINAL_V5_/g, 'FINAL_V9_')
    .replace(/v5_concat\.txt/g, 'v9_concat.txt')
    .replace(/final_v5_mp4_created/g, 'final_v9_mp4_created');

  // Let each spoken idea land before the next reveal. Questions and high-impact metrics get a slightly longer beat.
  src = src
    .replace(
      'function buildChunkVideo(sceneNo,chunkNo,frame,audio,audioDuration,isLastInScene){const hold=isLastInScene?BETWEEN_SCENE_HOLD:BETWEEN_CHUNK_HOLD;',
      "function buildChunkVideo(sceneNo,chunkNo,frame,audio,audioDuration,isLastInScene,chunkText){const impactful=/\\?|\\$|%|million|thousand|out of 100|qualified paths|revenue|exposed|risk|protect|expand|capture/i.test(String(chunkText||''));const hold=isLastInScene?BETWEEN_SCENE_HOLD:(impactful?0.45:BETWEEN_CHUNK_HOLD);"
    )
    .replace(
      'const seg=buildChunkVideo(scene.scene,chunkNo,frame,audio.file,audio.duration,chunkNo===chunks.length);',
      'const seg=buildChunkVideo(scene.scene,chunkNo,frame,audio.file,audio.duration,chunkNo===chunks.length,chunks[i]);'
    );

  const anchor = "if(!Array.isArray(master.scenes)||master.scenes.length!==11)throw new Error('APPROVED_SCENE_COUNT_INVALID');const pyExe=ensureEdgeTts(status);";
  const injected = "if(!Array.isArray(master.scenes)||master.scenes.length!==11)throw new Error('APPROVED_SCENE_COUNT_INVALID');" +
    "const intro={scene:0,title:'Welcome to the P2GC Federal Growth Review',durationSeconds:0,avatarSeconds:0,emotionalBeat:'Welcome',screen:['Glad you are able to review this today','Federal data → clearer growth picture','Let’s get started'],selfDiagnosis:null,narration:\"I’m glad you’re able to review this today. In the next few minutes, we’ll show how P2GC turns federal data into a clearer growth picture. Let’s get started.\"};" +
    "const scene10=master.scenes.find(s=>s.scene===10);if(scene10){scene10.narration=scene10.narration+\" And for companies with strong state, local, or education performance that want to expand federally, the same review can also identify a practical SLED-to-Fed pathway.\";scene10.screen=[...(scene10.screen||[]),'SLED → FED EXPANSION','Translate proven SLED performance into a federal growth pathway.'];}" +
    "master.scenes.unshift(intro);const pyExe=ensureEdgeTts(status);";

  if (!src.includes(anchor)) throw new Error('V9_INJECTION_ANCHOR_NOT_FOUND');
  src = src.replace(anchor, injected);

  src = src
    .replace("status.all11Scenes='PASS';status.audio='PASS';", "status.all11Scenes='PASS';status.intro='PASS';status.sledToFed='PASS';status.audio='PASS';status.pointLandingPauses='PASS';")
    .replace("status.goGreen=true;", "status.targetRuntimeSeconds=490;status.runtimeTargetWindowSeconds=[475,510];status.goGreen=actual>=475&&actual<=510;");

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
