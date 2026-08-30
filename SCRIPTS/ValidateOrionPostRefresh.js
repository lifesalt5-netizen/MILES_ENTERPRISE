'use strict';
const fs=require('fs');
const path=require('path');
const Database=require('better-sqlite3');
const OrionComponentFreshnessService=require('../SERVICES/orion/OrionComponentFreshnessService');
const OrionSidecarOverlayService=require('../SERVICES/orion/OrionSidecarOverlayService');

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}}
function main(){
  const rootDir=path.resolve(process.argv[2]||process.env.MILES_ROOT||path.resolve(__dirname,'..'));
  process.env.MILES_ROOT=rootDir;
  const reportPath=path.join(rootDir,'DATA','orion_refresh','latest_contract_sidecar_build.json');
  const sidecar=readJson(reportPath);
  if(!sidecar?.ok) throw new Error('ORION_SIDECAR_REPORT_NOT_GREEN');
  if(!sidecar.sidecarDb||!fs.existsSync(sidecar.sidecarDb)) throw new Error('ORION_SIDECAR_DB_MISSING');
  if(sidecar.safety?.productionDatabaseModified!==false||sidecar.safety?.sidecarOnly!==true) throw new Error('ORION_SIDECAR_SAFETY_ASSERTION_FAILED');
  const db=new Database(sidecar.sidecarDb,{readonly:true,fileMustExist:true});
  let counts;
  try{
    const integrity=db.pragma('integrity_check',{simple:true});
    counts={
      integrity,
      awards:Number(db.prepare('SELECT COUNT(*) n FROM orion_award_refresh_fy2026').get().n||0),
      contractors:Number(db.prepare('SELECT COUNT(*) n FROM orion_contractor_fy2026_summary').get().n||0),
      buyers:Number(db.prepare('SELECT COUNT(*) n FROM orion_buyer_fy2026_summary').get().n||0),
      recompetes:Number(db.prepare('SELECT COUNT(*) n FROM orion_recompete_fy2026').get().n||0)
    };
    if(integrity!=='ok'||counts.awards<=0||counts.contractors<=0) throw new Error(`ORION_SIDECAR_VALIDATION_FAILED:${JSON.stringify(counts)}`);
  }finally{db.close();}
  const freshness=new OrionComponentFreshnessService({rootDir}).run(null);
  if(!freshness.sidecarUsable) throw new Error('ORION_COMPONENT_FRESHNESS_DID_NOT_ACCEPT_SIDECAR');
  const overlay=new OrionSidecarOverlayService({rootDir});
  let overlayStatus;
  try{overlayStatus=overlay.status();}finally{overlay.close();}
  const result={
    ok:true,
    service:'ORION_POST_REFRESH_VALIDATION',
    generatedAt:new Date().toISOString(),
    sidecarDb:sidecar.sidecarDb,
    sidecarBytes:sidecar.sidecarBytes||fs.statSync(sidecar.sidecarDb).size,
    counts,
    source:sidecar.source||null,
    validation:sidecar.validation||null,
    componentFreshness:freshness,
    overlayStatus,
    safety:{readOnly:true,productionDatabaseModified:false,sidecarModified:false,fullFreshnessClaimed:freshness.fullyFresh===true}
  };
  const out=path.join(rootDir,'DATA','orion_refresh','latest_post_refresh_validation.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify(result,null,2));
}
if(require.main===module){try{main();}catch(e){console.error(JSON.stringify({ok:false,service:'ORION_POST_REFRESH_VALIDATION',error:e.message},null,2));process.exitCode=2;}}
module.exports={main};
