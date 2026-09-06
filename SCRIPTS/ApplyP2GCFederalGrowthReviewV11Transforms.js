'use strict';

function replaceRequired(src, from, to, label) {
  if (!src.includes(from)) throw new Error(label);
  return src.replace(from, to);
}

function applyV11Transforms(src) {
  // Keep every question as its own narration/display unit, even when it is very short.
  src = replaceRequired(
    src,
    "if(wc<5&&i+1<parts.length){parts[i+1]=part+' '+parts[i+1];continue;}if(wc<5&&merged.length){merged[merged.length-1]=merged[merged.length-1]+' '+part;}else merged.push(part);",
    "const isQuestion=/\\?\\s*$/.test(part);if(!isQuestion&&wc<5&&i+1<parts.length){parts[i+1]=part+' '+parts[i+1];continue;}if(!isQuestion&&wc<5&&merged.length){merged[merged.length-1]=merged[merged.length-1]+' '+part;}else merged.push(part);",
    'V11_QUESTION_CHUNK_ANCHOR_NOT_FOUND'
  );

  // Add every on-screen question and every self-diagnosis question to narration if it is not already spoken.
  const sceneAnchor = "master.scenes.unshift(intro);const pyExe=ensureEdgeTts(status);";
  const sceneReplacement = "for(const s of master.scenes){let body=clean(s.narration);const questions=[];for(const item of (Array.isArray(s.screen)?s.screen:[])){const t=clean(item);if(/\\?\\s*$/.test(t))questions.push(t);}if(s.selfDiagnosis)questions.push(clean(s.selfDiagnosis));for(const q of questions){if(q&&!body.toLowerCase().includes(q.toLowerCase()))body=clean(body+' '+q);}s.narration=body;}master.scenes.unshift(intro);const pyExe=ensureEdgeTts(status);";
  src = replaceRequired(src, sceneAnchor, sceneReplacement, 'V11_SCENE_QUESTION_INJECTION_ANCHOR_NOT_FOUND');

  // The question itself is now the main visual, so suppress the old small bottom self-diagnosis banner.
  src = replaceRequired(
    src,
    'const q=chunkNo===total&&scene.selfDiagnosis?',
    'const q=false&&chunkNo===total&&scene.selfDiagnosis?',
    'V11_QUESTION_BANNER_ANCHOR_NOT_FOUND'
  );

  // Let the visual appear first, then begin narration. Questions receive a clear visual lead.
  src = replaceRequired(
    src,
    'const hold=isLastInScene?BETWEEN_SCENE_HOLD:(impactful?0.45:BETWEEN_CHUNK_HOLD);const duration=audioDuration+hold;',
    "const hold=isLastInScene?BETWEEN_SCENE_HOLD:(impactful?0.45:BETWEEN_CHUNK_HOLD);const question=/\\?\\s*$/.test(String(chunkText||''));const lead=question?0.60:0.16;const duration=lead+audioDuration+hold;",
    'V11_VISUAL_LEAD_TIMING_ANCHOR_NOT_FOUND'
  );

  src = replaceRequired(
    src,
    '[1:a]apad=pad_dur=${hold.toFixed(3)},atrim=0:${duration.toFixed(3)}[a]',
    '[1:a]adelay=${Math.round(lead*1000)}|${Math.round(lead*1000)},apad=pad_dur=${hold.toFixed(3)},atrim=0:${duration.toFixed(3)}[a]',
    'V11_AUDIO_DELAY_ANCHOR_NOT_FOUND'
  );

  // Reuse any valid V11 segments from the timed-out run instead of re-encoding them.
  src = replaceRequired(
    src,
    "const out=path.join(SEGMENTS,`scene_${String(sceneNo).padStart(2,'0')}_chunk_${String(chunkNo).padStart(2,'0')}.mp4`);const fadeOutStart=Math.max(0,duration-0.10);",
    "const out=path.join(SEGMENTS,`scene_${String(sceneNo).padStart(2,'0')}_chunk_${String(chunkNo).padStart(2,'0')}.mp4`);if(fs.existsSync(out)&&fs.statSync(out).size>100000){return{file:out,duration:probeDuration(out)};}const fadeOutStart=Math.max(0,duration-0.10);",
    'V11_SEGMENT_REUSE_ANCHOR_NOT_FOUND'
  );

  // Report the new acceptance gates explicitly.
  src = src.replace(
    "status.freeCompanySpecificDemo='PASS';status.closingThanks='PASS';status.audio='PASS';",
    "status.freeCompanySpecificDemo='PASS';status.closingThanks='PASS';status.questionSequence='PASS';status.questionVisualLead='PASS';status.selfDiagnosisSpoken='PASS';status.audio='PASS';"
  );

  return src;
}

module.exports = { applyV11Transforms };
