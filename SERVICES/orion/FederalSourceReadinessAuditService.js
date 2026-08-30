'use strict';

const fs=require('fs');
const path=require('path');
const https=require('https');

const KEY_ENV_NAMES=['SAM_API_KEY','SAM_GOV_API_KEY'];
const ENTITY_DATA_SERVICES='https://sam.gov/data-services/Entity%20Registration/Public%20V2';
const ENTITY_LISTFILES='https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Entity%20Registration/Public%20V2&privacy=Public';
const OPPORTUNITY_DATA_SERVICES='https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public';
const OPPORTUNITY_FULL_DOWNLOAD='https://sam.gov/api/prod/fileextractservices/v1/api/download/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv?privacy=Public';

function presentKeys(env,names=KEY_ENV_NAMES){return names.map(name=>({envName:name,value:String(env[name]||'').trim()})).filter(x=>x.value).map(x=>({...x,length:x.value.length}));}
function firstPresentEnv(env,names){const first=presentKeys(env,names)[0];return first?{present:true,...first}:{present:false,envName:null,length:0,value:null};}
function mmddyyyy(date){const d=new Date(date);return `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`;}
function probeJson(url,timeoutMs=20000){return new Promise(resolve=>{const started=Date.now();let settled=false;const done=v=>{if(settled)return;settled=true;resolve({...v,durationMs:Date.now()-started});};const req=https.get(url,{headers:{'user-agent':'MILES-P2GC-FEDERAL-SOURCE-READINESS/1.3','accept':'application/json'}},res=>{const chunks=[];let bytes=0;res.on('data',c=>{if(bytes<65536){chunks.push(c);bytes+=c.length;}});res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');let json=null;try{json=JSON.parse(text);}catch{}done({ok:res.statusCode>=200&&res.statusCode<300,statusCode:res.statusCode,contentType:res.headers['content-type']||null,responseKeys:json&&typeof json==='object'?Object.keys(json).slice(0,20):[],errorHint:res.statusCode>=400?(json?.message||json?.error||text.slice(0,180)||null):null,json});});});req.setTimeout(timeoutMs,()=>req.destroy(new Error('HTTP_TIMEOUT')));req.on('error',e=>done({ok:false,statusCode:null,contentType:null,responseKeys:[],errorHint:e.message,json:null}));});}
function probeHead(url,timeoutMs=20000){return new Promise(resolve=>{const started=Date.now();let settled=false;const done=v=>{if(settled)return;settled=true;resolve({...v,durationMs:Date.now()-started});};const req=https.request(url,{method:'HEAD',headers:{'user-agent':'MILES-P2GC-FEDERAL-SOURCE-READINESS/1.3'}},res=>{res.resume();res.on('end',()=>done({ok:res.statusCode>=200&&res.statusCode<400,statusCode:res.statusCode,contentType:res.headers['content-type']||null,contentLength:Number(res.headers['content-length']||0)||null,location:res.headers.location||null}));});req.setTimeout(timeoutMs,()=>req.destroy(new Error('HTTP_TIMEOUT')));req.on('error',e=>done({ok:false,statusCode:null,contentType:null,contentLength:null,location:null,errorHint:e.message}));req.end();});}
function sanitizedProbe(probe){return probe?{ok:probe.ok,statusCode:probe.statusCode,contentType:probe.contentType,responseKeys:probe.responseKeys,errorHint:probe.errorHint,durationMs:probe.durationMs}:null;}
function latestUtf8EntityExtract(listJson){const rows=listJson?._embedded?.customS3ObjectSummaryList||[];return rows.filter(x=>/SAM_PUBLIC_UTF-8_MONTHLY_V2_\d{8}\.ZIP$/i.test(String(x.displayKey||''))).sort((a,b)=>String(b.dateModified||'').localeCompare(String(a.dateModified||'')))[0]||null;}

class FederalSourceReadinessAuditService{
  constructor(options={}){this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||process.cwd());this.env=options.env||process.env;this.now=options.now?new Date(options.now):new Date();this.timeoutMs=Math.max(5000,Number(options.timeoutMs||20000));this.reportPath=path.join(this.rootDir,'DATA','orion_refresh','latest_federal_source_readiness.json');this.probeTargetedApi=['1','true','yes','on'].includes(String(this.env.SAM_TARGETED_API_PROBE||'').toLowerCase());}
  async probeCandidate(candidate){const to=new Date(this.now),from=new Date(this.now);from.setUTCDate(from.getUTCDate()-1);const opp=new URL('https://api.sam.gov/opportunities/v2/search');opp.searchParams.set('api_key',candidate.value);opp.searchParams.set('postedFrom',mmddyyyy(from));opp.searchParams.set('postedTo',mmddyyyy(to));opp.searchParams.set('limit','1');opp.searchParams.set('offset','0');const opportunity=await probeJson(opp,this.timeoutMs);const ent=new URL('https://api.sam.gov/entity-information/v3/entities');ent.searchParams.set('api_key',candidate.value);ent.searchParams.set('registrationStatus','A');ent.searchParams.set('includeSections','entityRegistration');ent.searchParams.set('page','0');ent.searchParams.set('size','1');const entity=await probeJson(ent,this.timeoutMs);return{envName:candidate.envName,length:candidate.length,opportunity:sanitizedProbe(opportunity),entity:sanitizedProbe(entity),bothGreen:opportunity.ok===true&&entity.ok===true};}
  async run(){
    const candidates=presentKeys(this.env);
    const attempts=[];let selected=null;
    if(this.probeTargetedApi){for(const candidate of candidates){const attempt=await this.probeCandidate(candidate);attempts.push(attempt);if(attempt.bothGreen){selected=attempt;break;}}}

    const entityListProbe=await probeJson(ENTITY_LISTFILES,this.timeoutMs);
    const latestEntity=entityListProbe.ok?latestUtf8EntityExtract(entityListProbe.json):null;
    const entityDownload=latestEntity?`https://sam.gov/api/prod/fileextractservices/v1/api/download/Entity%20Registration/Public%20V2/${encodeURIComponent(latestEntity.displayKey)}?privacy=Public`:null;
    const opportunityHead=await probeHead(OPPORTUNITY_FULL_DOWNLOAD,this.timeoutMs);

    const samBulk={
      primaryForFullRefresh:true,
      entityRegistration:{
        source:'SAM.gov Data Services - Entity Registration Public V2',
        listingPage:ENTITY_DATA_SERVICES,
        listFilesEndpoint:ENTITY_LISTFILES,
        listProbe:{ok:entityListProbe.ok,statusCode:entityListProbe.statusCode,errorHint:entityListProbe.errorHint||null},
        latestFile:latestEntity?{displayKey:latestEntity.displayKey,dateModified:latestEntity.dateModified||null,size:latestEntity.size||null,downloadUrl:entityDownload}:null,
        ready:!!latestEntity
      },
      contractOpportunities:{
        source:'SAM.gov Data Services - Contract Opportunities datagov',
        listingPage:OPPORTUNITY_DATA_SERVICES,
        fileName:'ContractOpportunitiesFullCSV.csv',
        downloadUrl:OPPORTUNITY_FULL_DOWNLOAD,
        ready:opportunityHead.ok===true,
        head:{ok:opportunityHead.ok,statusCode:opportunityHead.statusCode,contentType:opportunityHead.contentType,contentLength:opportunityHead.contentLength,location:opportunityHead.location||null,errorHint:opportunityHead.errorHint||null}
      },
      policy:{
        useBulkExtractForOrionScaleRefresh:true,
        targetedApiOnlyForIncrementalLookups:true,
        automated401DoesNotInvalidateUserConfirmedKey:true,
        throttleAndBackoffTargetedApi:true,
        noAuthenticatedSamScraping:true
      }
    };

    const api={
      role:'TARGETED_INCREMENTAL_ONLY',
      probeEnabled:this.probeTargetedApi,
      keyPresent:candidates.length>0,
      presentKeyEnvNames:candidates.map(x=>x.envName),
      selectedKeyEnvName:selected?.envName||null,
      candidateAttempts:attempts.map(x=>({envName:x.envName,length:x.length,bothGreen:x.bothGreen,opportunity:x.opportunity,entity:x.entity})),
      interpretation:!this.probeTargetedApi?'NOT_PROBED_BY_DEFAULT_FOR_FULL_REFRESH':selected?'TARGETED_API_PROBE_GREEN':'TARGETED_API_PROBE_NOT_GREEN_BUT_NOT_A_FULL_REFRESH_BLOCKER'
    };

    const gsaMas={source:'GSA eLibrary',officialSite:'https://www.gsaelibrary.gsa.gov/ElibMain/home.do',apiKeyRequired:false,sourceMethod:'Schedule/SIN-driven public eLibrary retrieval',retrieval:'Use MAS schedule/category/SIN pages and contractor download links (CSV/XLS when offered) to resolve awarded SINs, schedule participation, contractor records, and related GSA MAS facts.',rules:{doNotTreatGsaApiKeyAsSamCredential:true,doNotUseSamApiForGsaMasAwardedSinTruth:true,verifyContractorPricelistForSpecificAwardedOfferings:true}};

    const blockers=[];
    if(!samBulk.entityRegistration.ready)blockers.push('SAM_ENTITY_PUBLIC_BULK_EXTRACT_NOT_DISCOVERED');
    if(!samBulk.contractOpportunities.ready)blockers.push('SAM_OPPORTUNITY_PUBLIC_BULK_EXTRACT_NOT_REACHABLE');
    const result={ok:blockers.length===0,service:'FEDERAL_SOURCE_READINESS_AUDIT',generatedAt:new Date().toISOString(),samBulk,credentials:{samApiKeyPresent:candidates.length>0,presentKeyEnvNames:candidates.map(x=>x.envName),selectedKeyEnvName:selected?.envName||null,keyValuesExposed:false},targetedApi:api,gsaMas,blockers,nextStep:blockers.length?'RETRY_PUBLIC_SAM_DATA_SERVICES_DISCOVERY_WITH_BACKOFF':'ACQUIRE_AND_STAGE_SAM_PUBLIC_ENTITY_AND_OPPORTUNITY_BULK_EXTRACTS',safety:{readOnly:true,secretValuesLogged:false,requestsMade:2+(attempts.length*2),productionDatabaseModified:false,credentialsModified:false,webScraping:false,officialPublicDataServicesOnlyForBulk:true,samApiNotRequiredForBulk:true,gsaMasSourceSeparatedFromSamApi:true}};
    fs.mkdirSync(path.dirname(this.reportPath),{recursive:true});fs.writeFileSync(this.reportPath,JSON.stringify(result,null,2),'utf8');return result;
  }
}
module.exports=FederalSourceReadinessAuditService;module.exports.firstPresentEnv=firstPresentEnv;module.exports.presentKeys=presentKeys;module.exports.mmddyyyy=mmddyyyy;module.exports.latestUtf8EntityExtract=latestUtf8EntityExtract;
