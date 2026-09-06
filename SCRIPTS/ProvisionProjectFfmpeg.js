'use strict';
const fs=require('fs');
const path=require('path');
const https=require('https');
const {spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const TARGET=path.join(ROOT,'TOOLS','ffmpeg','bin','ffmpeg.exe');
const ZIP=path.join(ROOT,'DATA','tools','ffmpeg-release-essentials.zip');
const EXTRACT=path.join(ROOT,'DATA','tools','ffmpeg_extract');
const URL='https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
function run(exe,args){return spawnSync(exe,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:16*1024*1024});}
function verify(p){if(!p||!fs.existsSync(p))return false;const r=run(p,['-version']);if(r.status!==0)return false;console.log(JSON.stringify({ffmpegFound:true,path:p,versionCheck:'PASS',version:(r.stdout||r.stderr||'').split(/\r?\n/)[0]}));return true;}
function findRecursive(dir){if(!fs.existsSync(dir))return null;for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory()){const r=findRecursive(p);if(r)return r;}else if(ent.name.toLowerCase()==='ffmpeg.exe')return p;}return null;}
function existing(){const c=[TARGET,'C:\\ffmpeg\\bin\\ffmpeg.exe','C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Microsoft','WinGet','Packages')];for(const p of c){if(!p)continue;if(fs.existsSync(p)&&fs.statSync(p).isFile()&&verify(p))return p;if(fs.existsSync(p)&&fs.statSync(p).isDirectory()){const r=findRecursive(p);if(r&&verify(r))return r;}}const w=run('where.exe',['ffmpeg.exe']);if(w.status===0){const p=(w.stdout||'').split(/\r?\n/).map(s=>s.trim()).find(Boolean);if(verify(p))return p;}return null;}
function download(url,dest){return new Promise((resolve,reject)=>{fs.mkdirSync(path.dirname(dest),{recursive:true});const go=u=>https.get(u,res=>{if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)return go(res.headers.location);if(res.statusCode!==200)return reject(new Error('FFMPEG_DOWNLOAD_HTTP_'+res.statusCode));const f=fs.createWriteStream(dest);res.pipe(f);f.on('finish',()=>f.close(resolve));}).on('error',reject);go(url);});}
async function main(){let p=existing();if(p)return p;await download(URL,ZIP);fs.rmSync(EXTRACT,{recursive:true,force:true});fs.mkdirSync(EXTRACT,{recursive:true});const x=run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`Expand-Archive -LiteralPath ${JSON.stringify(ZIP)} -DestinationPath ${JSON.stringify(EXTRACT)} -Force`]);if(x.status!==0)throw new Error('FFMPEG_EXTRACT_FAILED:'+(x.stderr||x.stdout||'').trim());p=findRecursive(EXTRACT);if(!p)throw new Error('FFMPEG_EXE_NOT_FOUND_AFTER_EXTRACT');fs.mkdirSync(path.dirname(TARGET),{recursive:true});fs.copyFileSync(p,TARGET);if(!verify(TARGET))throw new Error('FFMPEG_VERSION_CHECK_FAILED');return TARGET;}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=2;});module.exports={main};