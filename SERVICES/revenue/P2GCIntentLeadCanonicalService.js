'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPERATURES = Object.freeze(['HOT','WARM','WATCH']);
const QUALIFYING_SIGNAL_TYPES = Object.freeze([
  'GOVCON_HELP_REQUEST','OPPORTUNITY_HELP','GOVCON_CONSULTANT_REQUEST','SAM_HELP','GSA_HELP','VA_HELP',
  'PROPOSAL_HELP','FIRST_CONTRACT_HELP','CERTIFICATION_NO_TRACTION','GSA_LOW_NO_SALES','EXPIRING_CONTRACT_REPLACEMENT',
  'TEAMING_SUBCONTRACTING_HELP','BECOME_GOVERNMENT_CONTRACTOR','CAPABILITY_REGISTRATION_NAICS_HELP',
  'COMPLIANCE_CAPTURE_BD_HELP','OTHER_CURRENT_GOVCON_PAIN'
]);
const HOT_TYPES = new Set(['GOVCON_HELP_REQUEST','GOVCON_CONSULTANT_REQUEST','PROPOSAL_HELP','OPPORTUNITY_HELP','SAM_HELP','GSA_HELP','VA_HELP','FIRST_CONTRACT_HELP']);
const REQUIRED_SIGNAL_FIELDS = Object.freeze(['sourcePlatform','sourceUrl','originalPostDate','needSummary','excerpt']);
const DEFAULT_MAX_SIGNAL_AGE_DAYS = 45;

function clean(v){ return String(v ?? '').trim(); }
function lower(v){ return clean(v).toLowerCase(); }
function normalizeCompany(v){ return clean(v).toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function normalizeDomain(v){
  const raw=clean(v); if(!raw) return '';
  try { const u=new URL(/^https?:\/\//i.test(raw)?raw:`https://${raw}`); return u.hostname.toLowerCase().replace(/^www\./,''); }
  catch { return raw.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/?#]/)[0]; }
}
function validUrl(v){ try { const u=new URL(clean(v)); return ['http:','https:'].includes(u.protocol); } catch { return false; } }
function parseDate(v){ const n=Date.parse(clean(v)); return Number.isFinite(n)?n:null; }
function stableId(parts){ return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0,24); }
function readJson(file,fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); } catch { return fallback; } }
function atomicWrite(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file); }
function appendJsonl(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.appendFileSync(file,JSON.stringify(value)+'\n','utf8'); }

class P2GCIntentLeadCanonicalService {
  constructor(options={}){
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
    this.now=options.now||(()=>new Date());
    this.maxSignalAgeDays=Math.max(1,Number(options.maxSignalAgeDays||process.env.P2GC_INTENT_SIGNAL_MAX_AGE_DAYS||DEFAULT_MAX_SIGNAL_AGE_DAYS));
    this.storeFile=options.storeFile||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','canonical_intent_leads.json');
    this.auditFile=options.auditFile||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads','canonical_intent_lead_audit.jsonl');
  }

  load(){ const s=readJson(this.storeFile,{version:1,records:[]}); if(!Array.isArray(s.records)) s.records=[]; return s; }
  save(state){ state.version=Math.max(1,Number(state.version||1)); state.generatedAt=this.now().toISOString(); atomicWrite(this.storeFile,state); return state; }

  identity(input={}){
    const email=lower(input.email||input.contactEmail);
    const domain=normalizeDomain(input.domain||input.website||input.companyDomain||(email.includes('@')?email.split('@')[1]:''));
    const company=normalizeCompany(input.company||input.companyName||input.legalName);
    const contact=lower(input.contactName||input.person||input.poster);
    return {email,domain,company,contact};
  }
  identityKeys(input={}){
    const x=this.identity(input);
    return [x.email&&`EMAIL:${x.email}`,x.domain&&`DOMAIN:${x.domain}`,x.company&&`COMPANY:${x.company}`,x.contact&&x.company&&`CONTACT:${x.contact}|${x.company}`].filter(Boolean);
  }

  signalAgeDays(input={}){
    const t=parseDate(input.originalPostDate||input.postDate||input.signalDate);
    if(!t) return null;
    return Math.floor((this.now().getTime()-t)/86400000);
  }

  validateSignal(input={}){
    const failures=[];
    const signalType=clean(input.signalType||input.leadCategory).toUpperCase().replace(/[^A-Z0-9]+/g,'_');
    if(!QUALIFYING_SIGNAL_TYPES.includes(signalType)) failures.push('NON_QUALIFYING_SIGNAL_TYPE');
    for(const field of REQUIRED_SIGNAL_FIELDS) if(!clean(input[field])) failures.push(`MISSING_${field.toUpperCase()}`);
    if(clean(input.sourceUrl)&&!validUrl(input.sourceUrl)) failures.push('SOURCE_URL_INVALID');
    const age=this.signalAgeDays(input);
    if(age===null) failures.push('ORIGINAL_POST_DATE_INVALID');
    else if(age< -1) failures.push('ORIGINAL_POST_DATE_IN_FUTURE');
    else if(age>this.maxSignalAgeDays && input.allowOlderSignal!==true) failures.push('SIGNAL_TOO_OLD');
    if(!clean(input.company||input.companyName) && !normalizeDomain(input.website||input.domain||input.companyDomain)) failures.push('COMPANY_IDENTITY_MISSING');
    return {ok:failures.length===0,failures,signalType,ageDays:age};
  }

  deriveTemperature(input={},validated=null){
    const v=validated||this.validateSignal(input);
    if(!v.ok) return 'WATCH';
    const explicit=clean(input.leadTemperature||input.temperature).toUpperCase();
    if(TEMPERATURES.includes(explicit)) return explicit;
    if(HOT_TYPES.has(v.signalType)) return 'HOT';
    if(v.signalType==='OTHER_CURRENT_GOVCON_PAIN') return 'WATCH';
    return 'WARM';
  }

  findExisting(state,input={}){
    const keys=new Set(this.identityKeys(input));
    if(!keys.size) return null;
    return state.records.find(r=>this.identityKeys(r).some(k=>keys.has(k)))||null;
  }

  upsert(input={}){
    const validation=this.validateSignal(input);
    if(!validation.ok) return {ok:false,status:'INTENT_LEAD_REJECTED',failures:validation.failures};
    const state=this.load();
    let record=this.findExisting(state,input);
    const created=!record;
    const now=this.now().toISOString();
    if(!record){ record={id:`INTENT-${stableId(this.identityKeys(input).concat([input.sourceUrl]))}`,createdAt:now,signals:[],outcomes:{}}; state.records.push(record); }

    const signalKey=stableId([clean(input.sourceUrl),clean(input.originalPostDate),clean(input.excerpt),validation.signalType]);
    const priorSignals=Array.isArray(record.signals)?record.signals:[];
    const signalExists=priorSignals.some(s=>s.signalKey===signalKey);
    if(!signalExists){
      priorSignals.push({
        signalKey,
        discoveredAt:clean(input.discoveredAt)||now,
        sourcePlatform:clean(input.sourcePlatform),
        sourceUrl:clean(input.sourceUrl),
        originalPostDate:clean(input.originalPostDate),
        signalType:validation.signalType,
        needSummary:clean(input.needSummary),
        excerpt:clean(input.excerpt).slice(0,600),
        urgency:clean(input.urgency)||null,
        fitRationale:clean(input.fitRationale)||null
      });
    }

    Object.assign(record,{
      company:clean(input.company||input.companyName)||record.company||null,
      website:clean(input.website)||record.website||null,
      domain:normalizeDomain(input.domain||input.website||input.companyDomain)||record.domain||null,
      contactName:clean(input.contactName||input.person||input.poster)||record.contactName||null,
      title:clean(input.title)||record.title||null,
      email:lower(input.email||input.contactEmail)||record.email||null,
      phone:clean(input.phone)||record.phone||null,
      profileUrl:clean(input.profileUrl||input.linkedin)||record.profileUrl||null,
      leadTemperature:this.deriveTemperature(input,validation),
      leadCategory:validation.signalType,
      currentNeed:clean(input.needSummary),
      researchCompleted:Boolean(input.researchCompleted??record.researchCompleted??false),
      outreachPrepared:Boolean(input.outreachPrepared??record.outreachPrepared??false),
      outreachSent:Boolean(input.outreachSent??record.outreachSent??false),
      followUpDate:clean(input.followUpDate)||record.followUpDate||null,
      response:clean(input.response)||record.response||null,
      meeting:clean(input.meeting)||record.meeting||null,
      recommendedService:clean(input.recommendedService)||record.recommendedService||null,
      proposal:clean(input.proposal)||record.proposal||null,
      disposition:clean(input.disposition)||record.disposition||'OPEN',
      revenue:Number.isFinite(Number(input.revenue))?Number(input.revenue):(record.revenue||0),
      notes:clean(input.notes)||record.notes||null,
      signals:priorSignals,
      updatedAt:now
    });
    this.save(state);
    appendJsonl(this.auditFile,{at:now,type:created?'INTENT_LEAD_CREATED':'INTENT_LEAD_UPDATED',recordId:record.id,signalKey,signalAdded:!signalExists,sourceUrl:clean(input.sourceUrl),temperature:record.leadTemperature,signalType:validation.signalType});
    return {ok:true,status:created?'INTENT_LEAD_CREATED':'INTENT_LEAD_UPDATED',created,signalAdded:!signalExists,record};
  }

  listQualified(){ return this.load().records.filter(r=>Array.isArray(r.signals)&&r.signals.length>0&&TEMPERATURES.includes(r.leadTemperature)); }
  metrics(){
    const rows=this.listQualified();
    const byTemperature=Object.fromEntries(TEMPERATURES.map(t=>[t,rows.filter(r=>r.leadTemperature===t).length]));
    return {ok:true,total:rows.length,byTemperature,researchCompleted:rows.filter(r=>r.researchCompleted).length,outreachPrepared:rows.filter(r=>r.outreachPrepared).length,outreachSent:rows.filter(r=>r.outreachSent).length,meetings:rows.filter(r=>clean(r.meeting)).length,proposals:rows.filter(r=>clean(r.proposal)).length,closedWon:rows.filter(r=>String(r.disposition).toUpperCase()==='WON').length,revenue:rows.reduce((n,r)=>n+Number(r.revenue||0),0)};
  }
}

module.exports=P2GCIntentLeadCanonicalService;
module.exports.QUALIFYING_SIGNAL_TYPES=QUALIFYING_SIGNAL_TYPES;
module.exports.TEMPERATURES=TEMPERATURES;
