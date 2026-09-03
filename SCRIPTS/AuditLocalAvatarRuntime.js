'use strict';

const {spawnSync}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'DATA','operational_acceptance','latest_local_avatar_runtime_audit.json');

function run(cmd,args=[],timeout=20000){
  try{const r=spawnSync(cmd,args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout});return{ok:r.status===0,status:r.status,stdout:String(r.stdout||'').trim().slice(0,12000),stderr:String(r.stderr||'').trim().slice(0,4000),error:r.error?.message||null};}
  catch(error){return{ok:false,error:error.message};}
}
function where(name){return process.platform==='win32'?run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','where',name],10000):run('which',[name],10000);}

function main(){
  const ffmpeg=where('ffmpeg');
  const ffprobe=where('ffprobe');
  const nvidia=where('nvidia-smi');
  const gpu=nvidia.ok?run('nvidia-smi',['--query-gpu=name,memory.total,driver_version','--format=csv,noheader'],20000):{ok:false,status:'NVIDIA_SMI_NOT_FOUND'};
  const pythonCmd=process.platform==='win32'?(where('python').ok?'python':(where('py').ok?'py':null)):(where('python3').ok?'python3':null);
  let python={ok:false,status:'PYTHON_NOT_FOUND'};
  if(pythonCmd){
    const code=`import json, importlib.util, platform\nmods=['torch','onnxruntime','cv2','numpy','PIL','soundfile','librosa']\no={'python':platform.python_version(),'modules':{m:bool(importlib.util.find_spec(m)) for m in mods}}\ntry:\n import torch\n o['torch_version']=torch.__version__\n o['cuda_available']=bool(torch.cuda.is_available())\n o['cuda_device']=torch.cuda.get_device_name(0) if torch.cuda.is_available() else None\n o['cuda_device_count']=torch.cuda.device_count()\nexcept Exception as e:\n o['torch_error']=str(e)\nprint(json.dumps(o))`;
    python=run(pythonCmd,['-c',code],30000);
    if(python.ok){try{python.parsed=JSON.parse(python.stdout);}catch{}}
  }
  const totalMemGb=Math.round(os.totalmem()/1024/1024/1024*10)/10;
  const result={
    ok:true,
    service:'LOCAL_AVATAR_RUNTIME_CAPABILITY_AUDIT',
    observedAt:new Date().toISOString(),
    platform:{platform:process.platform,release:os.release(),arch:os.arch(),cpu:os.cpus()?.[0]?.model||null,cpuCount:os.cpus()?.length||null,totalMemoryGb:totalMemGb},
    ffmpeg:{available:ffmpeg.ok,path:ffmpeg.stdout||null},
    ffprobe:{available:ffprobe.ok,path:ffprobe.stdout||null},
    nvidia:{cliAvailable:nvidia.ok,gpuQuery:gpu},
    python:{command:pythonCmd,available:Boolean(pythonCmd),probe:python},
    recommendation:{
      localTalkingAvatarCandidate:Boolean(ffmpeg.ok&&pythonCmd&&(gpu.ok||python.parsed?.modules?.onnxruntime||python.parsed?.modules?.torch)),
      gpuAcceleratedCandidate:Boolean(ffmpeg.ok&&gpu.ok&&python.parsed?.cuda_available),
      cpuOnlyCandidate:Boolean(pythonCmd&&(python.parsed?.modules?.onnxruntime||python.parsed?.modules?.torch)),
      needsFfmpegInstall:!ffmpeg.ok,
      needsModelInstall:true,
      paidSubscriptionRequired:false
    },
    safety:{readOnly:true,packagesInstalled:false,modelsDownloaded:false,filesModifiedExceptAuditOutput:true,paidAction:false}
  };
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));
}
if(require.main===module){try{main();}catch(error){console.error(error.stack||error.message);process.exit(2);}}
