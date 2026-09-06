'use strict';

// Final pacing/content wrapper around the narration-synced V5 renderer.
// Adds a short welcome, one SLED-to-Fed mention, and targets ~8:00 without long topic gaps.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'RenderP2GCFederalGrowthReviewV5SpeechSync.js');
const GENERATED = path.join(__dirname, '_runtime_RenderP2GCFederalGrowthReviewV7FinalPaced.js');

function main() {
  let src = fs.readFileSync(SOURCE, 'utf8');

  src = src
    .replace("path.join(ROOT,'DATA','reusable_demo','v5')", "path.join(ROOT,'DATA','reusable_demo','v7')")
    .replace('P2GC_Federal_Growth_Review_Demo_V5.mp4', 'P2GC_Federal_Growth_Review_Demo_V7.mp4')
    .replace('latest_p2gc_v5_render.json', 'latest_p2gc_v7_render.json')
    .replace("const RATE='-8%';", "const RATE='-18%';")
    .replace('const BETWEEN_CHUNK_HOLD=0.10;', 'const BETWEEN_CHUNK_HOLD=0.14;')
    .replace('const BETWEEN_SCENE_HOLD=0.18;', 'const BETWEEN_SCENE_HOLD=0.20;')
    .replace(/V5_SPEECH_SYNC_RENDER/g, 'V7_FINAL_PACED_RENDER')
    .replace(/Final V5 speech-synced MP4 created/g, 'Final V7 paced speech-synced MP4 created')
    .replace(/FINAL_V5_/g, 'FINAL_V7_')
    .replace(/v5_concat\.txt/g, 'v7_concat.txt')
    .replace(/final_v5_mp4_created/g, 'final_v7_mp4_created');

  const anchor = "if(!Array.isArray(master.scenes)||master.scenes.length!==11)throw new Error('APPROVED_SCENE_COUNT_INVALID');const pyExe=ensureEdgeTts(status);";
  const injected = "if(!Array.isArray(master.scenes)||master.scenes.length!==11)throw new Error('APPROVED_SCENE_COUNT_INVALID');" +
    "const intro={scene:0,title:'Welcome to the P2GC Federal Growth Review',durationSeconds:0,avatarSeconds:0,emotionalBeat:'Welcome',screen:['Glad you are able to review this today','Federal data → clearer growth picture','Let’s get started'],selfDiagnosis:null,narration:\"I’m glad you’re able to review this today. In the next few minutes, we’ll show how P2GC turns federal data into a clearer growth picture. Let’s get started.\"};" +
    "const scene10=master.scenes.find(s=>s.scene===10);if(scene10){scene10.narration=scene10.narration+\" And for companies with strong state, local, or education performance that want to expand federally, the same review can also identify a practical SLED-to-Fed pathway.\";scene10.screen=[...(scene10.screen||[]),'SLED → FED EXPANSION','Translate proven SLED performance into a federal growth pathway.'];}" +
    "master.scenes.unshift(intro);const pyExe=ensureEdgeTts(status);";

  if (!src.includes(anchor)) throw new Error('V7_INJECTION_ANCHOR_NOT_FOUND');
  src = src.replace(anchor, injected);

  src = src
    .replace("status.all11Scenes='PASS';status.audio='PASS';", "status.all11Scenes='PASS';status.intro='PASS';status.sledToFed='PASS';status.audio='PASS';")
    .replace("status.goGreen=true;", "status.targetRuntimeSeconds=480;status.runtimeTargetWindowSeconds=[465,495];status.goGreen=actual>=465&&actual<=495;");

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
