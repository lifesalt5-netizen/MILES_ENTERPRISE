'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawnSync}=require('child_process');

const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'DATA','operational_acceptance','latest_p2gc_funnel_gateway_candidates.json');
const PORT=8779;

function run(cmd,args=[],timeout=60000){try{const r=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout});return{ok:r.status===0,status:r.status,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim().slice(0,4000),error:r.error?.message||null};}catch(error){return{ok:false,error:error.message};}}
function parseJson(v){try{return JSON.parse(String(v||''));}catch{return null;}}
function discoverRunPy(){
  if(process.platform!=='win32')return[];
  const base=path.dirname(ROOT).replace(/'/g,"''");
  const ps=`$roots=@('${base}',$env:USERPROFILE,$env:ProgramData,$env:TEMP) | Where-Object {$_ -and (Test-Path -LiteralPath $_)} | Select-Object -Unique; $out=@(); foreach($r in $roots){$out += Get-ChildItem -LiteralPath $r -Filter run.py -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 50 -ExpandProperty FullName}; $out | Select-Object -Unique -First 100 | ConvertTo-Json -Compress`;
  const r=run('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],60000);const parsed=parseJson(r.stdout);return Array.isArray(parsed)?parsed:(typeof parsed==='string'?[parsed]:[]);
}
function liveProcessChain(){
  if(process.platform!=='win32')return[];
  const ps=`$c=Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){return}; $id=[int]$c.OwningProcess; $out=@(); for($i=0;$i -lt 7 -and $id -gt 0;$i++){ $p=Get-CimInstance Win32_Process -Filter \"ProcessId=$id\" -ErrorAction SilentlyContinue; if(-not $p){break}; $out += [pscustomobject]@{pid=$p.ProcessId;parentPid=$p.ParentProcessId;name=$p.Name;executablePath=$p.ExecutablePath;commandLine=$p.CommandLine;creationDate=$p.CreationDate}; $id=[int]$p.ParentProcessId }; $out | ConvertTo-Json -Compress`;
  const r=run('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],20000);const parsed=parseJson(r.stdout);return Array.isArray(parsed)?parsed:(parsed?[parsed]:[]);
}
function commandCorpus(chain){return chain.map(p=>String(p.commandLine||'')).join('\n').toLowerCase();}
function launchHints(chain){
  const text=chain.map(p=>String(p.commandLine||'')).join('\n');const hints=new Set();
  for(const m of text.matchAll(/([A-Za-z]:\\[^\r\n"']+?)(?:\\run\.py|\s+run\.py|["'])/gi))hints.add(String(m[1]).replace(/[\\/]+$/,''));
  for(const m of text.matchAll(/(?:cd|chdir|set-location)\s+(?:\/d\s+)?["']?([A-Za-z]:\\[^\r\n"'&;]+)/gi))hints.add(String(m[1]).trim().replace(/[\\/]+$/,''));
  return[...hints];
}
function inspect(file,chainText,hints){
  try{
    const stat=fs.statSync(file);if(!stat.isFile()||stat.size>2*1024*1024)return null;
    const text=fs.readFileSync(file,'utf8');const lower=text.toLowerCase();const normalized=file.toLowerCase();const dir=path.dirname(file).toLowerCase();
    const launchedExact=chainText.includes(normalized);const launchDirHint=hints.some(h=>dir===String(h).toLowerCase()||dir.startsWith(`${String(h).toLowerCase()}\\`));
    const markers={
      port8779:/\b8779\b/.test(text),
      reviewPath:lower.includes('/review'),
      apiReview:lower.includes('/api/review'),
      adminReview:lower.includes('/api/admin/review'),
      adminBlock:/403|forbidden|deny|blocked/.test(lower),
      localhost8792:/127\.0\.0\.1[^\n]{0,120}8792|8792[^\n]{0,120}127\.0\.0\.1/.test(lower),
      proxy:/proxy|upstream|urlopen|http\.client|requests\.|urllib/.test(lower),
      server:/httpserver|threadinghttpserver|basehttprequesthandler|flask|fastapi|uvicorn|aiohttp/.test(lower),
      launchedExact,
      launchDirHint
    };
    const score=(markers.port8779?8:0)+(markers.reviewPath?3:0)+(markers.apiReview?4:0)+(markers.adminReview?6:0)+(markers.adminBlock?3:0)+(markers.localhost8792?7:0)+(markers.proxy?4:0)+(markers.server?2:0)+(markers.launchedExact?30:0)+(markers.launchDirHint?18:0);
    return{path:file,size:stat.size,modifiedAt:stat.mtime.toISOString(),sha256:crypto.createHash('sha256').update(text).digest('hex'),score,markers};
  }catch(error){return{path:file,error:error.message,score:-1,markers:{}};}
}
function main(){
  const chain=liveProcessChain();const corpus=commandCorpus(chain);const hints=launchHints(chain);const paths=discoverRunPy();const candidates=paths.map(file=>inspect(file,corpus,hints)).filter(Boolean).sort((a,b)=>(b.score||0)-(a.score||0));const best=candidates[0]||null;
  const highConfidence=Boolean(best&&((best.markers?.launchedExact)||(best.markers?.launchDirHint&&best.markers?.server)||(best.score>=25&&best.markers?.port8779&&best.markers?.server)));
  const result={ok:true,service:'P2GC_FUNNEL_GATEWAY_CANDIDATE_AUDIT',observedAt:new Date().toISOString(),liveProcessChain:chain,launchHints:hints,candidateCount:candidates.length,bestCandidate:best,highConfidence,candidates:candidates.slice(0,25),safety:{readOnly:true,filesChanged:false,networkChanged:false,processChanged:false}};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));
}
if(require.main===module){try{main();}catch(error){console.error(error.stack||error.message);process.exit(2);}}
