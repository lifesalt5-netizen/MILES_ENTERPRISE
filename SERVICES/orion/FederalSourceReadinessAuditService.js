'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

function firstPresentEnv(env, names) {
  for (const name of names) {
    const value = String(env[name] || '').trim();
    if (value) return { present: true, envName: name, length: value.length, value };
  }
  return { present: false, envName: null, length: 0, value: null };
}
function mmddyyyy(date) {
  const d = new Date(date);
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}
function probeJson(url, timeoutMs=20000) {
  return new Promise(resolve => {
    const started = Date.now(); let settled=false;
    const done = value => { if(settled)return; settled=true; resolve({...value,durationMs:Date.now()-started}); };
    const req=https.get(url,{headers:{'user-agent':'MILES-P2GC-FEDERAL-SOURCE-READINESS/1.0','accept':'application/json'}},res=>{
      const chunks=[]; let bytes=0;
      res.on('data',c=>{ if(bytes<65536){chunks.push(c);bytes+=c.length;} });
      res.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8'); let json=null;
        try{json=JSON.parse(text);}catch{}
        done({ok:res.statusCode>=200&&res.statusCode<300,statusCode:res.statusCode,contentType:res.headers['content-type']||null,responseKeys:json&&typeof json==='object'?Object.keys(json).slice(0,20):[],errorHint:res.statusCode>=400?(json?.message||json?.error||text.slice(0,180)||null):null});
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error',e=>done({ok:false,statusCode:null,contentType:null,responseKeys:[],errorHint:e.message}));
  });
}

class FederalSourceReadinessAuditService {
  constructor(options={}) {
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||process.cwd());
    this.env=options.env||process.env;
    this.now=options.now?new Date(options.now):new Date();
    this.timeoutMs=Math.max(5000,Number(options.timeoutMs||20000));
    this.reportPath=path.join(this.rootDir,'DATA','orion_refresh','latest_federal_source_readiness.json');
  }

  async run() {
    const key=firstPresentEnv(this.env,['SAM_API_KEY','SAM_GOV_API_KEY','GSA_API_KEY']);
    const opportunity={
      officialEndpoint:'https://api.sam.gov/opportunities/v2/search',
      apiKeyRequired:true,
      keyPresent:key.present,
      keyEnvName:key.envName,
      probe:null,
      scope:'Current published federal contract opportunities'
    };
    const entity={
      officialEndpoint:'https://api.sam.gov/entity-information/v3/entities',
      apiKeyRequired:true,
      keyPresent:key.present,
      keyEnvName:key.envName,
      probe:null,
      scope:'Current SAM entity/registration truth',
      bulkStrategyRequired:true,
      note:'Per-entity polling is not an acceptable refresh strategy for the full ORION contractor population; use a permitted SAM bulk extract/system-account path when available.'
    };

    if(key.present) {
      const to=new Date(this.now); const from=new Date(this.now); from.setUTCDate(from.getUTCDate()-1);
      const opp=new URL(opportunity.officialEndpoint);
      opp.searchParams.set('api_key',key.value); opp.searchParams.set('postedFrom',mmddyyyy(from)); opp.searchParams.set('postedTo',mmddyyyy(to)); opp.searchParams.set('limit','1'); opp.searchParams.set('offset','0');
      opportunity.probe=await probeJson(opp,this.timeoutMs);

      const ent=new URL(entity.officialEndpoint);
      ent.searchParams.set('api_key',key.value); ent.searchParams.set('registrationStatus','A'); ent.searchParams.set('includeSections','entityRegistration'); ent.searchParams.set('page','0'); ent.searchParams.set('size','1');
      entity.probe=await probeJson(ent,this.timeoutMs);
    }

    const blockers=[];
    if(!key.present) blockers.push('SAM_API_KEY_NOT_PRESENT');
    else {
      if(opportunity.probe?.ok!==true) blockers.push('SAM_OPPORTUNITIES_API_PROBE_NOT_GREEN');
      if(entity.probe?.ok!==true) blockers.push('SAM_ENTITY_API_PROBE_NOT_GREEN');
    }
    const result={
      ok:blockers.length===0,
      service:'FEDERAL_SOURCE_READINESS_AUDIT',
      generatedAt:new Date().toISOString(),
      credentials:{samApiKeyPresent:key.present,samApiKeyEnvName:key.envName,keyValueExposed:false},
      opportunity,
      entity,
      blockers,
      nextStep:!key.present?'CONFIGURE_SAM_API_KEY_WITHOUT_EXPOSING_SECRET':blockers.length?'REPAIR_SAM_API_CONNECTIVITY_OR_KEY_SCOPE':'BUILD_GOVERNED_OPPORTUNITY_REFRESH_AND_SAM_BULK_ENTITY_REFRESH',
      safety:{readOnly:true,secretValuesLogged:false,requestsMade:key.present?2:0,productionDatabaseModified:false,credentialsModified:false,webScraping:false,officialApisOnly:true}
    };
    fs.mkdirSync(path.dirname(this.reportPath),{recursive:true});
    fs.writeFileSync(this.reportPath,JSON.stringify(result,null,2),'utf8');
    return result;
  }
}

module.exports=FederalSourceReadinessAuditService;
module.exports.firstPresentEnv=firstPresentEnv;
module.exports.mmddyyyy=mmddyyyy;
