'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_WRAPPER = path.join(__dirname, 'RenderP2GCFederalGrowthReviewV10CopyFix.js');
const TEMP_WRAPPER = path.join(__dirname, '_runtime_BuildP2GCFederalGrowthReviewV13QuestionSequence.js');

function main() {
  let wrapper = fs.readFileSync(SOURCE_WRAPPER, 'utf8');

  wrapper = wrapper
    .replace("const { spawnSync } = require('child_process');", "const { spawnSync } = require('child_process');\nconst { applyV11Transforms } = require('./ApplyP2GCFederalGrowthReviewV11Transforms');\nconst { applyV12Tighten } = require('./ApplyP2GCFederalGrowthReviewV12Tighten');\nconst { applyV13Pacing } = require('./ApplyP2GCFederalGrowthReviewV13Pacing');")
    .replace('_runtime_RenderP2GCFederalGrowthReviewV10CopyFix.js', '_runtime_RenderP2GCFederalGrowthReviewV13QuestionSequence.js')
    .replace("path.join(ROOT,'DATA','reusable_demo','v10')", "path.join(ROOT,'DATA','reusable_demo','v13')")
    .replace('P2GC_Federal_Growth_Review_Demo_V10.mp4', 'P2GC_Federal_Growth_Review_Demo_V13.mp4')
    .replace('latest_p2gc_v10_render.json', 'latest_p2gc_v13_render.json')
    .replace('timeout: 1800000,', 'timeout: 5400000,')
    .replace("fs.writeFileSync(GENERATED, src, 'utf8');", "src = applyV11Transforms(src);\n  src = applyV12Tighten(src);\n  src = applyV13Pacing(src);\n\n  fs.writeFileSync(GENERATED, src, 'utf8');");

  if (!wrapper.includes('applyV11Transforms(src)') || !wrapper.includes('applyV12Tighten(src)') || !wrapper.includes('applyV13Pacing(src)')) {
    throw new Error('V13_WRAPPER_TRANSFORM_INJECTION_FAILED');
  }

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
