'use strict';

const fs=require('fs');
const path=require('path');

function clean(v){return String(v==null?'':v).trim();}
function list(v){return Array.isArray(v)?v.filter(Boolean):[];}
function uniq(values){return [...new Set((values||[]).map(clean).filter(Boolean))];}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}

class PrimeCandidateDiscoveryService{
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.reportPath=path.join(this.rootDir,'DATA','orion_refresh','latest_contract_sidecar_build.json');
    this.Database=options.Database||null;
  }

  sourceStatus(){
    let report=null;
    try{report=JSON.parse(fs.readFileSync(this.reportPath,'utf8').replace(/^\uFEFF/,''));}catch{}
    const database=report?.sidecarDb?path.resolve(report.sidecarDb):null;
    const usable=Boolean(report?.ok===true&&report?.validation?.ok===true&&report?.validation?.integrity==='ok'&&report?.safety?.sidecarOnly===true&&report?.safety?.productionDatabaseModified===false&&database&&fs.existsSync(database));
    return {usable,database:usable?database:null,source:usable?report?.source||null:null,validation:usable?report?.validation||null:null,reportPath:this.reportPath};
  }

  discover(model={},options={}){
    const source=this.sourceStatus();
    if(!source.usable)return {ok:false,status:'PRIME_DISCOVERY_SIDECAR_UNAVAILABLE',records:[],source};
    const prospectUei=clean(model?.profile?.uei).toUpperCase();
    const naics=uniq(list(model?.profile?.naicsCodes).map(x=>clean(x).replace(/\D/g,'')).filter(x=>x.length>=5)).slice(0,8);
    const agencies=uniq([
      ...list(model?.buyerIntelligence?.records).map(x=>x?.agency),
      ...list(model?.agencyAlignment?.agencies).map(x=>x?.agency)
    ]).slice(0,10);
    if(!prospectUei||(!naics.length&&!agencies.length))return {ok:false,status:'PRIME_DISCOVERY_INPUTS_INSUFFICIENT',records:[],source};

    if(!this.Database)this.Database=require('better-sqlite3');
    const db=new this.Database(source.database,{readonly:true,fileMustExist:true});
    try{
      const prospectSummary=db.prepare('SELECT federal_obligations FROM orion_contractor_fy2026_summary WHERE uei=?').get(prospectUei)||null;
      const prospectFederal=Math.abs(num(prospectSummary?.federal_obligations)||0);
      let candidates=[];

      if(agencies.length){
        const qs=agencies.map(()=>'?').join(',');
        candidates=db.prepare(`
          SELECT b.uei,
                 SUM(ABS(b.spend)) AS shared_agency_spend,
                 SUM(b.award_count) AS shared_agency_awards,
                 GROUP_CONCAT(DISTINCT b.agency) AS shared_agencies
          FROM orion_buyer_fy2026_summary b
          WHERE b.uei<>? AND b.agency IN (${qs})
          GROUP BY b.uei
          ORDER BY shared_agency_spend DESC, shared_agency_awards DESC
          LIMIT 80
        `).all(prospectUei,...agencies);
      }

      if(!candidates.length&&naics.length){
        const qs=naics.map(()=>'?').join(',');
        candidates=db.prepare(`
          SELECT a.uei,
                 SUM(ABS(a.obligation)) AS shared_agency_spend,
                 COUNT(*) AS shared_agency_awards,
                 '' AS shared_agencies
          FROM orion_award_refresh_fy2026 a
          WHERE a.uei<>? AND a.naics_code IN (${qs})
          GROUP BY a.uei
          ORDER BY shared_agency_spend DESC, shared_agency_awards DESC
          LIMIT 80
        `).all(prospectUei,...naics);
      }

      const summaryStmt=db.prepare('SELECT federal_obligations, award_count FROM orion_contractor_fy2026_summary WHERE uei=?');
      const nameStmt=db.prepare(`SELECT recipient_name FROM orion_award_refresh_fy2026 WHERE uei=? AND COALESCE(recipient_name,'')<>'' ORDER BY ABS(obligation) DESC LIMIT 1`);
      const naicsStmt=naics.length?db.prepare(`SELECT COUNT(*) AS n FROM orion_award_refresh_fy2026 WHERE uei=? AND naics_code IN (${naics.map(()=>'?').join(',')})`):null;
      const result=[];
      for(const row of candidates){
        const uei=clean(row.uei).toUpperCase();
        if(!uei||uei===prospectUei)continue;
        const summary=summaryStmt.get(uei)||null;
        const federal=Math.abs(num(summary?.federal_obligations)||0);
        if(federal<=0)continue;
        const name=clean(nameStmt.get(uei)?.recipient_name);
        if(!name)continue;
        const sameNaicsAwards=naicsStmt?Number(naicsStmt.get(uei,...naics)?.n||0):0;
        const sharedAgencies=uniq(clean(row.shared_agencies).split(',')).filter(Boolean);
        const scaleSignal=prospectFederal<=0||federal>prospectFederal;
        const evidenceSignals=(sharedAgencies.length?1:0)+(sameNaicsAwards>0?1:0)+(scaleSignal?1:0);
        if(evidenceSignals<2)continue;
        const score=Math.min(100,45+Math.min(25,sharedAgencies.length*5)+Math.min(20,sameNaicsAwards*2)+(scaleSignal?10:0));
        result.push({
          company:name,
          uei,
          vehicle:null,
          federalRevenue:federal,
          awardCount:num(summary?.award_count),
          agencies:sharedAgencies,
          fitScore:score,
          sameNaicsAwardCount:sameNaicsAwards,
          basis:`Validated FY2026 prime-award evidence: ${sharedAgencies.length?`${sharedAgencies.length} shared buyer agenc${sharedAgencies.length===1?'y':'ies'}`:'buyer overlap unavailable'}${sameNaicsAwards?`; ${sameNaicsAwards} award${sameNaicsAwards===1?'':'s'} in prospect NAICS`:''}${scaleSignal?'; larger current federal obligation scale':''}.`,
          confidence:'MODELED_CANDIDATE_VALIDATED_AWARD_INPUTS',
          partnerStatus:'MODELED_PRIME_TEAMING_CANDIDATE',
          evidence:{authority:'USAspending.gov validated FY2026 sidecar',sharedAgencies,sameNaicsAwardCount:sameNaicsAwards,federalObligations:federal,sourceReport:source.reportPath},
          disclosure:'Candidate is evidence-backed for prime/team research, not a confirmed existing subcontracting relationship. Validate current contract, vehicle, capability whitespace and SBLO contact before outreach.'
        });
      }
      result.sort((a,b)=>(b.fitScore-a.fitScore)||(b.federalRevenue-a.federalRevenue));
      const limit=Math.max(1,Math.min(Number(options.limit||20),50));
      return {ok:true,status:result.length?'EVIDENCE_BACKED_PRIME_CANDIDATES_AVAILABLE':'NO_DEFENSIBLE_PRIME_CANDIDATES_FROM_CURRENT_SIDECAR',records:result.slice(0,limit),source,safety:{readOnly:true,productionDatabaseModified:false,contactsInvented:false}};
    }finally{try{db.close();}catch{}}
  }
}

module.exports=PrimeCandidateDiscoveryService;
