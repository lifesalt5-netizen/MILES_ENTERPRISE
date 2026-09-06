'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_WRAPPER = path.join(__dirname, 'RenderP2GCFederalGrowthReviewV10CopyFix.js');
const TEMP_WRAPPER = path.join(__dirname, '_runtime_BuildP2GCFederalGrowthReviewV11QuestionSequence.js');

function main() {
  let wrapper = fs.readFileSync(SOURCE_WRAPPER, 'utf8');

  wrapper = wrapper
    .replace("const { spawnSync } = require('child_process');", "const { spawnSync } = require('child_process');\nconst { applyV11Transforms } = require('./ApplyP2GCFederalGrowthReviewV11Transforms');")
    .replace('_runtime_RenderP2GCFederalGrowthReviewV10CopyFix.js', '_runtime_RenderP2GCFederalGrowthReviewV11QuestionSequence.js')
    .replace("path.join(ROOT,'DATA','reusable_demo','v10')", "path.join(ROOT,'DATA','reusable_demo','v11')")
    .replace('P2GC_Federal_Growth_Review_Demo_V10.mp4', 'P2GC_Federal_Growth_Review_Demo_V11.mp4')
    .replace('latest_p2gc_v10_render.json', 'latest_p2gc_v11_render.json')
    .replace(/V10_COPY_FIX_RENDER/g, 'V11_QUESTION_SEQUENCE_RENDER')
    .replace(/Final V10 corrected speech-synced MP4 created/g, 'Final V11 question-sequenced MP4 created')
    .replace(/FINAL_V10_/g, 'FINAL_V11_')
    .replace(/v10_concat\.txt/g, 'v11_concat.txt')
    .replace(/final_v10_mp4_created/g, 'final_v11_mp4_created')
    .replace('timeout: 1800000,', 'timeout: 5400000,')
    .replace("fs.writeFileSync(GENERATED, src, 'utf8');", "src = applyV11Transforms(src);\n\n  fs.writeFileSync(GENERATED, src, 'utf8');");

  if (!wrapper.includes('applyV11Transforms(src)')) throw new Error('V11_WRAPPER_TRANSFORM_INJECTION_FAILED');

  fs.writeFileSync(TEMP_WRAPPER, wrapper, 'utf8');
  const r = spawnSync(process.execPath, [TEMP_WRAPPER], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5400000,
    maxBuffer: 32 * 1024 * 1024
  });

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw r.error;
  if (r.status !== 0) process.exitCode = r.status || 2;
}

if (require.main === module) main();
module.exports = { main };
