'use strict';
const fs=require('fs');
const path=require('path');

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}}
function stat(file){try{const s=fs.statSync(file);return{exists:true,bytes:s.size,mtime:s.mtime.toISOString(),isFile:s.isFile()};}catch{return{exists:false,bytes:null,mtime:null,isFile:false};}}
function listDir(dir){try{return fs.readdirSync(dir).map(name=>{const file=path.join(dir,name);return{name,...stat(file)};}).sort((a,b)=>String(b.mtime||'').localeCompare(String(a.mtime||'')));}catch{return[];}}
function freeBytes(target){try{if(typeof fs.statfsSync!=='function')return null;const root=path.parse(path.resolve(target)).root||target;const s=fs.statfsSync(root);return Number(s.bavail??s.bfree??0)*Number(s.bsize??s.frsize??0);}catch{return null;}}

function main(){
 const root=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
 const refresh=path.join(root,'DATA','orion_refresh');
 const staging=path.join(refresh,'staging_db');
 const reportFile=path.join(refresh,'latest_contract_sidecar_build.json');
 const oldReportFile=path.join(refresh,'latest_contract_staging_build.json');
 const acquisitionFile=path.join(refresh,'latest_official_source_staging_acquisition.json');
 const schemaFile=path.join(refresh,'latest_refresh_target_schema_audit.json');
 const report=readJson(reportFile);
 const oldReport=readJson(oldReportFile);
 const acquisition=readJson(acquisitionFile);
 const schema=readJson(schemaFile);
 const files=listDir(staging);
 const sidecars=files.filter(x=>/^ORION_CONTRACT_SIDECAR_/i.test(x.name));
 const stagingClones=files.filter(x=>/^ORION_CONTRACT_STAGING_/i.test(x.name));
 const partials=files.filter(x=>/\.partial\.db$/i.test(x.name));
 const result={
  ok:true,service:'ORION_SIDECAR_BUILD_STATE_AUDIT',observedAt:new Date().toISOString(),readOnly:true,
  report:{file:reportFile,stat:stat(reportFile),content:report},
  priorStagingReport:{file:oldReportFile,stat:stat(oldReportFile),content:oldReport},
  acquisition:{file:acquisitionFile,stat:stat(acquisitionFile),ok:acquisition?.ok===true,downloads:(acquisition?.downloads||[]).map(x=>({role:x.role,fileName:x.fileName,path:x.path,downloadedBytes:x.downloadedBytes,sha256:x.sha256,updatedDate:x.updatedDate}))},
  schemaAudit:{file:schemaFile,stat:stat(schemaFile),ok:schema?.ok===true,currentDb:schema?.currentDb||null},
  stagingDir:{path:staging,freeBytes:freeBytes(staging),fileCount:files.length,sidecarCount:sidecars.length,partialCount:partials.length,stagingCloneCount:stagingClones.length,files:files.slice(0,30)},
  diagnosis: report?.ok===true?'GREEN_REPORT_PRESENT':sidecars.some(x=>x.name.endsWith('.db'))?'SIDECAR_DB_PRESENT_WITHOUT_GREEN_REPORT':partials.length?'PARTIAL_DB_REMAINS':'NO_GREEN_REPORT_OR_SIDECAR_DB',
  safety:{filesChanged:0,processesRestarted:0,productionDatabaseModified:false,sidecarModified:false,credentialsRead:false}
 };
 console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main();
