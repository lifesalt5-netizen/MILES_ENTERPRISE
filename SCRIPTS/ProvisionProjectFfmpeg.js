'use strict';
const fs=require('fs');
const path=require('path');
const https=require('https');
const {spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const BIN_DIR=path.join(ROOT,'TOOLS','ffmpeg','bin');
const TARGET=path.join(BIN_DIR,'ffmpeg.exe');
const PROBE_TARGET=path.join(BIN_DIR,'ffprobe.exe');
const ZIP=path.join(ROOT,'DATA','tools','ffmpeg-release-essentials.zip');
const EXTRACT=path.join(ROOT,'DATA','tools','ffmpeg_extract');
const URL='https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
function run(exe,args){return spawnSync(exe,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:16*1024*1024});}
function verify(p,label='ffmpeg'){if(!p||!fs.existsSync(p))return false;const r=run(p,['-version']);if(r.status!==0)return false;console.log(JSON.stringify({tool:label,found:true,path:p,versionCheck:'PASS',version:(r.stdout||r.stderr||'').split(/\r?\n/)[0]}));return true;}
function findRecursive(dir,name){if(!fs.existsSync(dir))return null;for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory()){const r=findRecursive(p,name);if(r)return r;}else if(ent.name.toLowerCase()===name.toLowerCase())return p;}return null;}
function findInstalled(name,target){const c=[target,'C:\\ffmpeg\\bin\\'+name,'C:\\Program Files\\ffmpeg\\bin\\'+name,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Microsoft','WinGet','Packages')];for(const p of c){if(!p)continue;if(fs.existsSync(p)&&fs.statSync(p).isFile()&&verify(p,name))return p;if(fs.existsSync(p)&&fs.statSync(p).isDirectory()){const r=findRecursive(p,name);if(r&&verify(r,name))return r;}}const w=run('where.exe',[name]);if(w.status===0){const p=(w.stdout||'').split(/\r?\n/).map(s=>s.trim()).find(Boolean);if(verify(p,name))return p;}return null;}
function download(url,dest){return new Promise((resolve,reject)=>{fs.mkdirSync(path.dirname(dest),{recursive:true});const go=u=>https.get(u,res=>{if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)return go(res.headers.location);if(res.statusCode!==200)return reject(new Error('FFMPEG_DOWNLOAD_HTTP_'+res.statusCode));const f=fs.createWriteStream(dest);res.pipe(f);f.on('finish',()=>f.close(resolve));}).on('error',reject);go(url);});}
async function main(){let ffmpeg=findInstalled('ffmpeg.exe',TARGET);let ffprobe=findInstalled('ffprobe.exe',PROBE_TARGET);if(ffmpeg&&ffprobe)return{ffmpeg,ffprobe};
if(!fs.existsSync(ZIP))await download(URL,ZIP);
fs.rmSync(EXTRACT,{recursive:true,force:true});fs.mkdirSync(EXTRACT,{recursive:true});
const x=run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`Expand-Archive -LiteralPath ${JSON.stringify(ZIP)} -DestinationPath ${JSON.stringify(EXTRACT)} -Force`]);if(x.status!==0)throw new Error('FFMPEG_EXTRACT_FAILED:'+(x.stderr||x.stdout||'').trim());
const ffmpegSrc=findRecursive(EXTRACT,'ffmpeg.exe');const ffprobeSrc=findRecursive(EXTRACT,'ffprobe.exe');if(!ffmpegSrc)throw new Error('FFMPEG_EXE_NOT_FOUND_AFTER_EXTRACT');if(!ffprobeSrc)throw new Error('FFPROBE_EXE_NOT_FOUND_AFTER_EXTRACT');
fs.mkdirSync(BIN_DIR,{recursive:true});if(!ffmpeg)fs.copyFileSync(ffmpegSrc,TARGET);if(!ffprobe)fs.copyFileSync(ffprobeSrc,PROBE_TARGET);
ffmpeg=TARGET;ffprobe=PROBE_TARGET;if(!verify(ffmpeg,'ffmpeg.exe'))throw new Error('FFMPEG_VERSION_CHECK_FAILED');if(!verify(ffprobe,'ffprobe.exe'))throw new Error('FFPROBE_VERSION_CHECK_FAILED');return{ffmpeg,ffprobe};}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=2;});module.exports={main};