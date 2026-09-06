'use strict';

// Pacing-only wrapper around the approved V5 speech-synced renderer.
// Keeps content and narration-driven reveal logic unchanged while targeting ~8:00 total runtime.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(__dirname, 'RenderP2GCFederalGrowthReviewV5SpeechSync.js');
const GENERATED = path.join(__dirname, '_runtime_RenderP2GCFederalGrowthReviewV6Paced.js');

function main() {
  let src = fs.readFileSync(SOURCE, 'utf8');
  src = src
    .replace("path.join(ROOT,'DATA','reusable_demo','v5')", "path.join(ROOT,'DATA','reusable_demo','v6')")
    .replace('P2GC_Federal_Growth_Review_Demo_V5.mp4', 'P2GC_Federal_Growth_Review_Demo_V6.mp4')
    .replace('latest_p2gc_v5_render.json', 'latest_p2gc_v6_render.json')
    .replace("const RATE='-8%';", "const RATE='-22%';")
    .replace('const BETWEEN_CHUNK_HOLD=0.10;', 'const BETWEEN_CHUNK_HOLD=0.15;')
    .replace('const BETWEEN_SCENE_HOLD=0.18;', 'const BETWEEN_SCENE_HOLD=0.20;')
    .replace(/V5_SPEECH_SYNC_RENDER/g, 'V6_PACED_SPEECH_SYNC_RENDER')
    .replace(/Final V5 speech-synced MP4 created/g, 'Final V6 paced speech-synced MP4 created')
    .replace(/FINAL_V5_/g, 'FINAL_V6_')
    .replace(/v5_concat\.txt/g, 'v6_concat.txt')
    .replace(/final_v5_mp4_created/g, 'final_v6_mp4_created');

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
