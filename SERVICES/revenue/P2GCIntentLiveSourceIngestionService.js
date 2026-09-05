'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function clean(v){ return String(v??'').trim(); }
function readJson(file,fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;} }
function atomicWrite(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); }
function appendJsonl(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.appendFileSync(file,JSON.stringify(value)+'\n','utf8'); }
function validHttpUrl(v){ try{ const u=new URL(clean(v)); return ['http:','https:'].includes(u.protocol); }catch{return false;} }
function hash(v){ return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function getPath(obj,p){ return clean(p).split('.').filter(Boolean).reduce((v,k)=>v==null?undefined:v[k],obj); }

const SIGNAL_RULES=[
  ['PROPOSAL_HELP',/\b(proposal|rfp|rfq|rfi)\b.{0,100}\b(help|support|writer|consultant|need|seeking|looking)\b|\b(help|support|writer|consultant|need|seeking|looking)\b.{0,100}\b(proposal|rfp|rfq|rfi)\b/i],
  ['SAM_HELP',/\bSAM(?:\.gov)?\b.{0,100}\b(help|registration|renew|consultant|issue|problem|need)\b|\b(help|consultant|need)\b.{0,100}\bSAM(?:\.gov)?\b/i],
  ['GSA_HELP',/\bGSA\b.{0,100}\b(help|schedule|sales|consultant|need|issue|problem)\b|\b(help|consultant|need)\b.{0,100}\bGSA\b/i],
  ['VA_HELP',/\bVA\b.{0,100}\b(contract|schedule|solicitation|help|consultant|need)\b/i],
  ['TEAMING_SUBCONTRACTING_HELP',/\b(teaming|subcontract(?:ing|or)?|prime contractor)\b.{0,100}\b(help|partner|seeking|looking|need)\b|\b(seeking|looking|need)\b.{0,100}\b(teaming|subcontract(?:ing|or)?|prime)\b/i],
  ['FIRST_CONTRACT_HELP',/\b(first|new)\b.{0,60}\b(government|federal)\b.{0,60}\bcontract\b|\bhow (?:do|can) (?:we|i)\b.{0,80}\bgovernment contract/i],
  ['GOVCON_CONSULTANT_REQUEST',/\b(government contracting|govcon|federal contracting)\b.{0,120}\b(consultant|expert|advisor|help|support|seeking|looking for|need)\b|\b(consultant|expert|advisor|help|support|seeking|looking for|need)\b.{0,120}\b(government contracting|govcon|federal contracting)\b/i],
  ['COMPLIANCE_CAPTURE_BD_HELP',/\b(capture|capability statement|NAICS|CAGE|compliance|business development)\b.{0,100}\b(help|consultant|need|seeking|looking)\b/i]
];

class P2GCIntentLiveSourceIngestionService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.fetchImpl=options.fetchImpl||global.fetch;
    this.now=options.now||(()=>new Date());
    this.manifestFile=options.manifestFile||process.env.P2GC_INTENT_SOURCE_MANIFEST||path.join(this.rootDir,'CONFIG','p2gc_intent_live_sources.json');
    this.signalFile=options.signalFile||process.env.P2GC_INTENT_DISCOVERY_SIGNAL_FILE||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','discovered_signals.json');
    this.auditFile=options.auditFile||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','live_source_ingestion_audit.jsonl');
  }

  classify(text,explicit){
    const e=clean(explicit).toUpperCase().replace(/[^A-Z0-9]+/g,'_');
    if(e) return e;
    for(const [type,re] of SIGNAL_RULES) if(re.test(clean(text))) return type;
    return null;
  }

  mapItem(source,item){
    const m=source.fieldMap||{};
    const value=(name,...fallbacks)=>{
      const mapped=clean(m[name]);
      if(mapped){ const v=getPath(item,mapped); if(v!=null) return v; }
      for(const k of fallbacks){ const v=getPath(item,k); if(v!=null) return v; }
      return null;
    };
    const needSummary=clean(value('needSummary','needSummary','title','name'));
    const excerpt=clean(value('excerpt','excerpt','description','body','content','text')).slice(0,600);
    const combined=`${needSummary}\n${excerpt}`;
    const signalType=this.classify(combined,value('signalType','signalType','leadCategory'));
    const sourceUrl=clean(value('sourceUrl','sourceUrl','url','link','permalink'));
    const originalPostDate=clean(value('originalPostDate','originalPostDate','publishedAt','published','createdAt','date'));
    const company=clean(value('company','company','companyName','organization','employer'));
    const website=clean(value('website','website','companyWebsite'));
    const domain=clean(value('domain','domain','companyDomain'));
    const failures=[];
    if(!signalType) failures.push('NO_HIGH_INTENT_SIGNAL');
    if(!validHttpUrl(sourceUrl)) failures.push('SOURCE_URL_INVALID');
    if(!originalPostDate || !Number.isFinite(Date.parse(originalPostDate))) failures.push('ORIGINAL_POST_DATE_INVALID');
    if(!company && !website && !domain) failures.push('COMPANY_IDENTITY_MISSING');
    if(!needSummary || !excerpt) failures.push('SIGNAL_EVIDENCE_INCOMPLETE');
    if(failures.length) return {ok:false,failures};
    return {ok:true,signal:{
      discoveredAt:this.now().toISOString(),
      company,website,domain,
      contactName:clean(value('contactName','contactName','person','author','poster')),
      title:clean(value('title','title','jobTitle')),
      email:clean(value('email','email','contactEmail')),
      phone:clean(value('phone','phone')),
      profileUrl:clean(value('profileUrl','profileUrl','linkedin','authorUrl')),
      sourcePlatform:clean(source.platform||source.name||'PUBLIC_WEB'),
      sourceUrl,originalPostDate,
      needSummary,excerpt,signalType,
      urgency:clean(value('urgency','urgency')),
      fitRationale:clean(value('fitRationale','fitRationale')),
      sourceEvidenceHash:hash(`${sourceUrl}|${originalPostDate}|${excerpt}`)
    }};
  }

  itemsFromPayload(source,payload){
    const p=clean(source.itemsPath);
    const items=p?getPath(payload,p):payload;
    return Array.isArray(items)?items:[];
  }

  async fetchSource(source){
    if(!source || source.enabled===false) return {ok:true,source:clean(source?.name),observed:0,qualified:[],rejected:[]};
    if(!validHttpUrl(source.url)) return {ok:false,source:clean(source.name),error:'SOURCE_ENDPOINT_INVALID',qualified:[],rejected:[]};
    if(typeof this.fetchImpl!=='function') return {ok:false,source:clean(source.name),error:'FETCH_UNAVAILABLE',qualified:[],rejected:[]};
    const response=await this.fetchImpl(source.url,{headers:{'accept':'application/json','user-agent':'MILES-P2GC-IntentLeadEngine/1.0'}});
    if(!response || response.ok!==true) return {ok:false,source:clean(source.name),error:`SOURCE_HTTP_${response?.status||'ERROR'}`,qualified:[],rejected:[]};
    let payload;
    try{ payload=await response.json(); }catch{ return {ok:false,source:clean(source.name),error:'SOURCE_JSON_INVALID',qualified:[],rejected:[]}; }
    const items=this.itemsFromPayload(source,payload);
    const qualified=[]; const rejected=[];
    for(const item of items){ const mapped=this.mapItem(source,item); if(mapped.ok) qualified.push(mapped.signal); else rejected.push({failures:mapped.failures}); }
    return {ok:true,source:clean(source.name),observed:items.length,qualified,rejected};
  }

  async run(options={}){
    const manifest=options.manifest||readJson(this.manifestFile,{version:1,sources:[]});
    const sources=Array.isArray(manifest)?manifest:(Array.isArray(manifest.sources)?manifest.sources:[]);
    if(!sources.length) return {ok:false,status:'INTENT_LIVE_SOURCE_BLOCKED_NO_SOURCES',observed:0,qualified:0,rejected:0,safety:{outboundSendPerformed:false,providerMutationPerformed:false}};
    const collected=[]; const results=[];
    for(const source of sources){
      try{ const r=await this.fetchSource(source); results.push(r); if(r.ok) collected.push(...r.qualified); }
      catch(err){ results.push({ok:false,source:clean(source?.name),error:`SOURCE_FETCH_FAILED:${clean(err?.message||err)}`,qualified:[],rejected:[]}); }
    }
    const unique=[]; const seen=new Set();
    for(const signal of collected){ const k=hash(`${signal.sourceUrl}|${signal.originalPostDate}|${signal.excerpt}`); if(!seen.has(k)){seen.add(k);unique.push(signal);} }
    const totalObserved=results.reduce((n,r)=>n+Number(r.observed||0),0);
    const totalRejected=results.reduce((n,r)=>n+(Array.isArray(r.rejected)?r.rejected.length:0),0);
    const failedSources=results.filter(r=>!r.ok).length;
    const artifact={version:1,generatedAt:this.now().toISOString(),signals:unique,sourceResults:results.map(r=>({source:r.source,ok:r.ok,observed:r.observed||0,qualified:r.qualified?.length||0,rejected:r.rejected?.length||0,error:r.error||null})),safety:{outboundSendPerformed:false,providerMutationPerformed:false}};
    atomicWrite(this.signalFile,artifact);
    appendJsonl(this.auditFile,{at:artifact.generatedAt,type:'INTENT_LIVE_SOURCE_INGESTION',sources:sources.length,failedSources,observed:totalObserved,qualified:unique.length,rejected:totalRejected,signalFile:this.signalFile});
    return {ok:failedSources===0,status:failedSources===0?'INTENT_LIVE_SOURCE_INGESTION_GREEN':'INTENT_LIVE_SOURCE_INGESTION_PARTIAL',observed:totalObserved,qualified:unique.length,rejected:totalRejected,failedSources,signalFile:this.signalFile,safety:artifact.safety};
  }
}

module.exports=P2GCIntentLiveSourceIngestionService;
