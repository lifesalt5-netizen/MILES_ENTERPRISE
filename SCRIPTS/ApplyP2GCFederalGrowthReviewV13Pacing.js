'use strict';

function replaceRequired(src, from, to, label) {
  if (!src.includes(from)) throw new Error(label);
  return src.replace(from, to);
}

function applyV13Pacing(src) {
  // Preserve V12's concise copy and V11's question sequencing; only restore deliberate breathing room.
  src = src
    .replace('const BETWEEN_CHUNK_HOLD=0.24;', 'const BETWEEN_CHUNK_HOLD=0.72;')
    .replace('const BETWEEN_SCENE_HOLD=0.60;', 'const BETWEEN_SCENE_HOLD=1.00;')
    .replace('(impactful?0.38:BETWEEN_CHUNK_HOLD)', '(impactful?0.92:BETWEEN_CHUNK_HOLD)')
    .replace('const lead=question?0.50:0.10;', 'const lead=question?0.85:0.48;');

  // Update status labels/window for the paced question-sequence pass.
  src = src
    .replace(/V12_TIGHT_QUESTION_SEQUENCE_RENDER/g, 'V13_PACED_QUESTION_SEQUENCE_RENDER')
    .replace(/Final V12 tightened question-sequenced MP4 created/g, 'Final V13 paced question-sequenced MP4 created')
    .replace(/FINAL_V12_/g, 'FINAL_V13_')
    .replace(/v12_concat\.txt/g, 'v13_concat.txt')
    .replace(/final_v12_mp4_created/g, 'final_v13_mp4_created')
    .replace('status.targetRuntimeSeconds=500;status.runtimeTargetWindowSeconds=[480,525];status.goGreen=actual>=480&&actual<=525;', 'status.targetRuntimeSeconds=480;status.runtimeTargetWindowSeconds=[470,500];status.goGreen=actual>=470&&actual<=500;');

  return src;
}

module.exports = { applyV13Pacing };
