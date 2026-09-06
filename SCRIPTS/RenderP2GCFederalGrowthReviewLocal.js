'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MASTER = path.join(ROOT, 'DATA', 'production_specs', 'p2gc_reusable_demo_master.json');
const ASSET_DIR = path.join(ROOT, 'DATA', 'reusable_demo', 'assets');
const AUDIO_DIR = path.join(ROOT, 'DATA', 'reusable_demo', 'audio_v3');
const EXPORT_DIR = path.join(ROOT, 'DATA', 'reusable_demo', 'exports');
const OUTPUT = path.join(EXPORT_DIR, 'P2GC_Federal_Growth_Review_Demo_V3.mp4');
const STATUS = path.join(ROOT, 'DATA', 'operational_acceptance', 'latest_p2gc_local_render.json');

function now(){ return new Date().toISOString(); }
function clean(v){ return String(v == null ? '' : v).trim(); }
function ensureDir(p){ fs.mkdirSync(p, { recursive:true }); }
function writeStatus(s){ ensureDir(path.dirname(STATUS)); s.updatedAt=now(); fs.writeFileSync(STATUS, JSON.stringify(s,null,2),'utf8'); }
function run(exe,args,opts={}){
  const r=spawnSync(exe,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:opts.timeout||600000,maxBuffer:8*1024*1024});
  return { ok:r.status===0, code:r.status, stdout:r.stdout||'', stderr:r.stderr||'', error:r.error ? r.error.message : null };
}
function which(name){
  if(process.platform==='win32'){
    const r=run('where.exe',[name],{timeout:10000});
    if(r.ok){ const p=clean(r.stdout).split(/\r?\n/)[0]; if(p && fs.existsSync(p)) return p; }
  }
  const r=run(process.platform==='win32'?'where.exe':'which',[name],{timeout:10000});
  if(r.ok){ const p=clean(r.stdout).split(/\r?\n/)[0]; if(p && fs.existsSync(p)) return p; }
  return null;
}
function findExisting(candidates){ return candidates.find(p=>p && fs.existsSync(p)) || null; }
function findPiper(){
  return which('piper.exe') || which('piper') || findExisting([
    path.join(ROOT,'TOOLS','piper','piper.exe'),
    path.join(ROOT,'DATA','tools','piper','piper.exe'),
    'C:\\piper\\piper.exe',
    'C:\\Program Files\\Piper\\piper.exe'
  ]);
}
function findFfmpeg(){
  return which('ffmpeg.exe') || which('ffmpeg') || findExisting([
    path.join(ROOT,'TOOLS','ffmpeg','bin','ffmpeg.exe'),
    path.join(ROOT,'DATA','tools','ffmpeg','bin','ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
  ]);
}
function wavDurationSeconds(file){
  const b=fs.readFileSync(file); if(b.length<44 || b.toString('ascii',0,4)!=='RIFF' || b.toString('ascii',8,12)!=='WAVE') throw new Error('WAV_HEADER_INVALID:'+file);
  let pos=12, byteRate=null, dataSize=null;
  while(pos+8<=b.length){ const id=b.toString('ascii',pos,pos+4); const size=b.readUInt32LE(pos+4); if(id==='fmt ' && size>=16) byteRate=b.readUInt32LE(pos+16); if(id==='data'){dataSize=size;break;} pos += 8 + size + (size%2); }
  if(!byteRate || dataSize==null) throw new Error('WAV_DURATION_PARSE_FAILED:'+file);
  return dataSize/byteRate;
}
function powershellTts(text,outFile,voiceName){
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$voices = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }`,
    `$preferred = ${JSON.stringify(voiceName||'Microsoft David Desktop')}`,
    'if ($voices -contains $preferred) { $s.SelectVoice($preferred) } elseif ($voices.Count -gt 0) { $s.SelectVoice($voices[0]) } else { throw "NO_WINDOWS_TTS_VOICE" }',
    '$s.Rate = 0',
    `$s.SetOutputToWaveFile(${JSON.stringify(outFile)})`,
    `$s.Speak(${JSON.stringify(text)})`,
    '$s.Dispose()',
    `if (-not (Test-Path ${JSON.stringify(outFile)})) { throw "TTS_OUTPUT_NOT_CREATED" }`
  ].join('; ');
  return run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{timeout:300000});
}
function piperTts(piper,text,outFile){
  const modelCandidates=[
    process.env.PIPER_MODEL,
    path.join(ROOT,'TOOLS','piper','en_US-lessac-medium.onnx'),
    path.join(ROOT,'DATA','tools','piper','en_US-lessac-medium.onnx'),
    path.dirname(piper) && path.join(path.dirname(piper),'en_US-lessac-medium.onnx')
  ].filter(Boolean);
  const model=findExisting(modelCandidates); if(!model) return {ok:false,error:'PIPER_MODEL_NOT_FOUND'};
  const r=spawnSync(piper,['--model',model,'--output_file',outFile],{cwd:ROOT,input:text,encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:8*1024*1024});
  return {ok:r.status===0,code:r.status,stdout:r.stdout||'',stderr:r.stderr||'',error:r.error?r.error.message:null,model};
}
function synthesizeScene(scene,piper,status){
  const out=path.join(AUDIO_DIR,`scene_${String(scene.scene).padStart(2,'0')}.wav`);
  if(fs.existsSync(out) && fs.statSync(out).size>10000){ const d=wavDurationSeconds(out); return {file:out,duration:d,engine:'EXISTING'}; }
  let r=null,engine=null;
  if(piper){ r=piperTts(piper,scene.narration,out); if(r.ok) engine='PIPER'; }
  if(!engine){ r=powershellTts(scene.narration,out,'Microsoft David Desktop'); if(r.ok) engine='WINDOWS_SYSTEM_SPEECH'; }
  if(!engine) throw new Error(`SCENE_${scene.scene}_TTS_FAILED:${clean((r&&r.error)||'')} ${clean((r&&r.stderr)||'')}`);
  if(!fs.existsSync(out) || fs.statSync(out).size<10000) throw new Error(`SCENE_${scene.scene}_WAV_NOT_CREATED`);
  const duration=wavDurationSeconds(out);
  if(duration<2) throw new Error(`SCENE_${scene.scene}_WAV_INVALID_DURATION:${duration}`);
  status.lastSuccessfulStep=`scene_${scene.scene}_wav_created`;
  status.currentScene=scene.scene;
  status.audioEngine=engine;
  status.lastLogActivity={at:now(),event:`scene_${String(scene.scene).padStart(2,'0')}.wav created (${duration.toFixed(2)}s) using ${engine}`};
  writeStatus(status);
  return {file:out,duration,engine};
}
function buildSceneVideo(ffmpeg,scene,img,audio,audioDuration,tempFile){
  const targetDuration=Math.max(Number(scene.durationSeconds)||0,audioDuration+0.75);
  const args=['-y','-loop','1','-framerate','30','-i',img,'-i',audio,'-filter_complex',`[0:v]scale=1920:1080,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0,targetDuration-0.35).toFixed(3)}:d=0.35[v];[1:a]apad=pad_dur=${Math.max(0,targetDuration-audioDuration).toFixed(3)},atrim=0:${targetDuration.toFixed(3)}[a]`,'-map','[v]','-map','[a]','-t',targetDuration.toFixed(3),'-r','30','-c:v','libx264','-preset','medium','-crf','20','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',tempFile];
  const r=run(ffmpeg,args,{timeout:900000});
  if(!r.ok) throw new Error(`SCENE_${scene.scene}_FFMPEG_FAILED:${clean(r.stderr||r.error).slice(-3000)}`);
  return targetDuration;
}
function concatVideos(ffmpeg,files,out){
  const list=path.join(EXPORT_DIR,'p2gc_v3_concat.txt');
  fs.writeFileSync(list,files.map(f=>`file '${f.replace(/'/g,"'\\''")}'`).join('\r\n'),'utf8');
  let r=run(ffmpeg,['-y','-f','concat','-safe','0','-i',list,'-c','copy',out],{timeout:900000});
  if(!r.ok){
    r=run(ffmpeg,['-y','-f','concat','-safe','0','-i',list,'-r','30','-c:v','libx264','-preset','medium','-crf','20','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart',out],{timeout:1200000});
  }
  if(!r.ok) throw new Error(`FINAL_FFMPEG_CONCAT_FAILED:${clean(r.stderr||r.error).slice(-4000)}`);
}
function main(){
  const status={ok:false,phase:'LOCAL_RENDER',processState:'RUNNING',currentStage:'tts',currentScene:1,startedAt:now(),lastSuccessfulStep:null,lastLogActivity:{at:now(),event:'local renderer started'},outputFile:OUTPUT,outputFileExists:false,partialOutputExists:false,error:null};
  writeStatus(status);
  try{
    ensureDir(AUDIO_DIR); ensureDir(EXPORT_DIR);
    const master=JSON.parse(fs.readFileSync(MASTER,'utf8').replace(/^\uFEFF/,''));
    if(!Array.isArray(master.scenes) || master.scenes.length!==11) throw new Error(`APPROVED_SCENE_COUNT_INVALID:${master.scenes&&master.scenes.length}`);
    const piper=findPiper();
    const ffmpeg=findFfmpeg();
    status.piper=piper||null; status.ffmpeg=ffmpeg||null; writeStatus(status);
    // Scene 1 first, verify WAV exists and parses before proceeding.
    const audio=[];
    const first=synthesizeScene(master.scenes[0],piper,status); audio.push(first);
    status.scene1AudioVerified=true; status.lastLogActivity={at:now(),event:`Scene 1 narration verified: ${first.file} (${first.duration.toFixed(2)}s)`}; writeStatus(status);
    for(let i=1;i<master.scenes.length;i++) audio.push(synthesizeScene(master.scenes[i],piper,status));
    status.currentStage='composition'; status.lastSuccessfulStep='all_11_wav_files_created'; status.lastLogActivity={at:now(),event:'All 11 narration WAV files created and verified'}; writeStatus(status);
    if(!ffmpeg) throw new Error('FFMPEG_NOT_FOUND_AFTER_TTS');
    const tempFiles=[]; let total=0;
    for(let i=0;i<master.scenes.length;i++){
      const scene=master.scenes[i]; const img=path.join(ASSET_DIR,`scene_${String(scene.scene).padStart(2,'0')}.png`);
      if(!fs.existsSync(img)) throw new Error(`SCENE_${scene.scene}_IMAGE_NOT_FOUND:${img}`);
      const temp=path.join(EXPORT_DIR,`p2gc_v3_scene_${String(scene.scene).padStart(2,'0')}.mp4`);
      status.currentScene=scene.scene; status.currentStage='composition'; status.lastLogActivity={at:now(),event:`Composing scene ${scene.scene}`}; writeStatus(status);
      total += buildSceneVideo(ffmpeg,scene,img,audio[i].file,audio[i].duration,temp); tempFiles.push(temp); status.partialOutputExists=true; status.lastSuccessfulStep=`scene_${scene.scene}_video_composed`; writeStatus(status);
    }
    status.currentStage='export'; status.lastLogActivity={at:now(),event:'Concatenating 11 scene videos into final MP4'}; writeStatus(status);
    concatVideos(ffmpeg,tempFiles,OUTPUT);
    if(!fs.existsSync(OUTPUT) || fs.statSync(OUTPUT).size<1000000) throw new Error('FINAL_MP4_MISSING_OR_TOO_SMALL');
    status.ok=true; status.processState='COMPLETED'; status.currentStage='complete'; status.outputFileExists=true; status.all11Scenes='PASS'; status.audio='PASS'; status.avatar='NOT_REQUIRED_FOR_V1'; status.export='1920x1080 H.264 MP4'; status.goGreen=true; status.estimatedRuntimeSeconds=total; status.finishedAt=now(); status.lastSuccessfulStep='final_mp4_created'; status.lastLogActivity={at:now(),event:`Final MP4 created: ${OUTPUT}`}; writeStatus(status);
    console.log(JSON.stringify(status,null,2));
  }catch(e){ status.processState='FAILED'; status.error=e.message; status.finishedAt=now(); status.outputFileExists=fs.existsSync(OUTPUT); status.partialOutputExists=status.partialOutputExists||fs.existsSync(AUDIO_DIR); status.lastLogActivity={at:now(),event:e.message}; writeStatus(status); console.error(JSON.stringify(status,null,2)); process.exitCode=2; }
}
if(require.main===module) main();
module.exports={main};
