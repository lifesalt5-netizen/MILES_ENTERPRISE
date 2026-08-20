"use strict";

const fs = require("fs");
const path = require("path");

const ROLE_PATTERN = /\b(capture manager|capture director|capture lead|capture analyst|capture executive|business development manager|business development director|bd manager|bd director|growth manager|growth director|growth executive|proposal manager|proposal director|proposal lead|proposal writer|proposal development|federal pricing analyst|pricing analyst|price[- ]to[- ]win)\b/i;
const DEFAULT_MAX_COMPANIES = 25;
const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;

function clean(value) { return String(value ?? "").trim(); }
function normalizeSpace(value) { return clean(value).replace(/\s+/g, " "); }
function stripHtml(value) { return normalizeSpace(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"')); }
function classify(text) {
  const value = String(text || "").toLowerCase();
  if (/capture manager|capture director|capture lead|capture analyst|capture executive/.test(value)) return "CAPTURE_HIRING";
  if (/business development manager|business development director|bd manager|bd director|growth manager|growth director|growth executive|proposal manager|proposal director|proposal lead|proposal writer|proposal development|federal pricing analyst|pricing analyst|price[- ]to[- ]win/.test(value)) return "BD_CAPTURE_OPENING";
  return null;
}
function companyFromDomain(value) {
  try {
    const host = new URL(/^https?:\/\//i.test(clean(value)) ? clean(value) : `https://${clean(value)}`).hostname.replace(/^www\./i, "");
    const stem = host.split(".")[0] || "";
    return stem.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  } catch { return ""; }
}
function absoluteUrl(base, href) { try { return new URL(href, base).toString(); } catch { return ""; } }
function validHttpUrl(value) { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol); } catch { return false; } }
function uniqueBy(items, keyFn) { const map = new Map(); for (const item of items) { const key = keyFn(item); if (key && !map.has(key)) map.set(key, item); } return [...map.values()]; }
function parseCsvLine(line) { const out=[]; let field="", quoted=false; for(let i=0;i<line.length;i++){const ch=line[i]; if(ch==='"'){ if(quoted&&line[i+1]==='"'){field+='"';i++;} else quoted=!quoted; } else if(ch===','&&!quoted){out.push(field);field="";} else field+=ch;} out.push(field); return out; }
function rowsFromFile(file) {
  const ext=path.extname(file).toLowerCase(); const text=fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"");
  if(ext===".json"){const x=JSON.parse(text); if(Array.isArray(x))return x; for(const k of ["rows","records","results","data","contacts","leads","candidates"])if(Array.isArray(x?.[k]))return x[k]; return x&&typeof x==="object"?[x]:[];}
  if(ext===".jsonl"||ext===".ndjson")return text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  if(ext===".csv"){const lines=text.split(/\r?\n/).filter(Boolean); if(lines.length<2)return[]; const headers=parseCsvLine(lines.shift()).map(clean); return lines.map(line=>{const vals=parseCsvLine(line); return Object.fromEntries(headers.map((h,i)=>[h,vals[i]??""]));});}
  return [];
}
function first(record, keys) { for (const key of keys) if (clean(record?.[key])) return clean(record[key]); return ""; }
function extractLinks(html, base) {
  const links=[]; const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(String(html||"")))){const url=absoluteUrl(base,m[1]); if(url)links.push({url,text:stripHtml(m[2])});}
  return links;
}
function atsDescriptor(url) {
  const value=clean(url); let m;
  if((m=value.match(/https?:\/\/(?:jobs\.)?lever\.co\/([^/?#]+)/i))) return {provider:"LEVER", key:m[1], api:`https://api.lever.co/v0/postings/${m[1]}?mode=json`};
  if((m=value.match(/https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/i))) return {provider:"GREENHOUSE", key:m[1], api:`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs?content=true`};
  if((m=value.match(/https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i))) return {provider:"ASHBY", key:m[1], api:`https://api.ashbyhq.com/posting-api/job-board/${m[1]}`};
  if(/\.applytojob\.com\//i.test(value)) return {provider:"APPLYTOJOB", key:value, api:value};
  return null;
}

class CaptureCapacityPublicWebSignalService {
  constructor(options={}) {
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,"..",".."));
    this.fetchImpl=options.fetchImpl||global.fetch;
    this.maxCompanies=Math.max(1,Math.min(100,Number(options.maxCompanies||process.env.CAPTURE_CAPACITY_PUBLIC_MAX_COMPANIES||DEFAULT_MAX_COMPANIES)));
    this.cacheMs=Math.max(0,Number(options.cacheMs ?? process.env.CAPTURE_CAPACITY_PUBLIC_CACHE_MS ?? DEFAULT_CACHE_MS));
    this.timeoutMs=Math.max(1000,Number(options.timeoutMs||DEFAULT_TIMEOUT_MS));
    this.contactSources=options.contactSources||null;
    this.explicitCareerUrls=options.careerUrls||null;
    this.outputFile=options.outputFile||path.join(this.rootDir,"DATA","runtime","revenue","capture_capacity","signals","public_web_signals_latest.json");
    this.reportFile=options.reportFile||path.join(this.rootDir,"DATA","runtime","revenue","capture_capacity","public_web_signal_search_latest.json");
  }
  writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2),"utf8");fs.renameSync(temp,file);return file;}
  configuredContactSources(){if(Array.isArray(this.contactSources))return this.contactSources;return clean(process.env.CAPTURE_CAPACITY_CONTACT_SOURCES).split(path.delimiter).map(clean).filter(Boolean);}
  configuredCareerUrls(){if(Array.isArray(this.explicitCareerUrls))return this.explicitCareerUrls;return clean(process.env.CAPTURE_CAPACITY_PUBLIC_CAREER_URLS).split(path.delimiter).map(clean).filter(Boolean);}
  companyUniverse(){
    const rows=[];
    for(const file of this.configuredContactSources()){
      if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
      try{for(const record of rowsFromFile(file)){
        const company=first(record,["company","company_name","companyName","legal_business_name","organization","vendor_name"]);
        let website=first(record,["website","company_website","company_url","url","domain"]);
        const email=first(record,["email","work_email","contact_email"]);
        if(!website&&email.includes("@"))website=`https://${email.split("@")[1]}`;
        if(website&&!/^https?:\/\//i.test(website))website=`https://${website}`;
        if(company&&validHttpUrl(website))rows.push({company,website});
      }}catch{/* source-level failure is reported indirectly by missing candidates */}
    }
    for(const url of this.configuredCareerUrls())if(validHttpUrl(url))rows.push({company:companyFromDomain(url),website:url,explicitCareer:true});
    return uniqueBy(rows,item=>`${item.company.toLowerCase()}|${new URL(item.website).hostname.toLowerCase()}`).slice(0,this.maxCompanies);
  }
  async fetchResponse(url,{json=false}={}){
    if(!this.fetchImpl)throw new Error("Global fetch is unavailable");
    const controller=typeof AbortController!=="undefined"?new AbortController():null; const timer=controller?setTimeout(()=>controller.abort(),this.timeoutMs):null;
    try{
      const response=await this.fetchImpl(url,{method:"GET",headers:{"User-Agent":"MILES-P2GC-Public-Signal-Monitor/1.0","Accept":json?"application/json":"text/html,application/json;q=0.9,*/*;q=0.5"},signal:controller?.signal});
      if(!response||response.ok!==true)throw new Error(`HTTP ${response?.status||"NO_STATUS"}`);
      return json?await response.json():await response.text();
    } finally { if(timer)clearTimeout(timer); }
  }
  normalizeJob({company,title,description,url,postedDate="",provider}){
    const t=normalizeSpace(title); const evidence=stripHtml(description||title); const trigger=classify(`${t} ${evidence}`);
    if(!company||!url||!ROLE_PATTERN.test(`${t} ${evidence}`)||!trigger)return null;
    return {company,trigger_type:trigger,title:t,evidence:normalizeSpace(`${t}. ${evidence}`).slice(0,1800),source_url:url,posted_date:clean(postedDate),source_provider:provider,source_type:"PUBLIC_CAREER_OR_ATS",retrieved_at:new Date().toISOString(),evidence_status:"PUBLIC_SOURCE_DISCOVERED_REQUIRES_STANDARD_IDENTITY_GATE"};
  }
  async jobsFromAts(company,descriptor){
    const jobs=[];
    if(descriptor.provider==="LEVER"){
      const payload=await this.fetchResponse(descriptor.api,{json:true});
      for(const row of Array.isArray(payload)?payload:[]){const job=this.normalizeJob({company,title:row.text,description:[row.descriptionPlain,row.additionalPlain].filter(Boolean).join(" "),url:row.hostedUrl||row.applyUrl,provider:"LEVER"});if(job)jobs.push(job);}
    } else if(descriptor.provider==="GREENHOUSE"){
      const payload=await this.fetchResponse(descriptor.api,{json:true});
      for(const row of Array.isArray(payload?.jobs)?payload.jobs:[]){const job=this.normalizeJob({company,title:row.title,description:row.content,url:row.absolute_url,postedDate:row.updated_at,provider:"GREENHOUSE"});if(job)jobs.push(job);}
    } else if(descriptor.provider==="ASHBY"){
      const payload=await this.fetchResponse(descriptor.api,{json:true});
      for(const row of Array.isArray(payload?.jobs)?payload.jobs:[]){const job=this.normalizeJob({company,title:row.title,description:[row.descriptionPlain,row.descriptionHtml].filter(Boolean).join(" "),url:row.jobUrl||row.applyUrl,postedDate:row.publishedAt,provider:"ASHBY"});if(job)jobs.push(job);}
    } else if(descriptor.provider==="APPLYTOJOB"){
      const html=await this.fetchResponse(descriptor.api);
      for(const link of extractLinks(html,descriptor.api))if(ROLE_PATTERN.test(link.text)){const job=this.normalizeJob({company,title:link.text,description:link.text,url:link.url,provider:"APPLYTOJOB"});if(job)jobs.push(job);}
      if(!jobs.length&&ROLE_PATTERN.test(stripHtml(html))){const title=(stripHtml(html).match(ROLE_PATTERN)||[])[0]||"GovCon growth opening";const job=this.normalizeJob({company,title,description:stripHtml(html).slice(0,1800),url:descriptor.api,provider:"APPLYTOJOB"});if(job)jobs.push(job);}
    }
    return jobs;
  }
  async scanCompany(companyRow){
    const {company,website}=companyRow; const errors=[]; const jobs=[]; const descriptors=[];
    const starting=companyRow.explicitCareer?[website]:[website,absoluteUrl(website,"/careers"),absoluteUrl(website,"/jobs")];
    for(const pageUrl of uniqueBy(starting.filter(Boolean),x=>x)){
      try{
        const direct=atsDescriptor(pageUrl); if(direct){descriptors.push(direct);continue;}
        const html=await this.fetchResponse(pageUrl); const links=extractLinks(html,pageUrl);
        for(const link of links){const descriptor=atsDescriptor(link.url);if(descriptor)descriptors.push(descriptor);}
        for(const link of links){if(ROLE_PATTERN.test(link.text)){const job=this.normalizeJob({company,title:link.text,description:link.text,url:link.url,provider:"COMPANY_CAREERS"});if(job)jobs.push(job);}}
      }catch(error){errors.push({url:pageUrl,error:error.message});}
    }
    for(const descriptor of uniqueBy(descriptors,d=>`${d.provider}|${d.key}`)){
      try{jobs.push(...await this.jobsFromAts(company,descriptor));}catch(error){errors.push({provider:descriptor.provider,url:descriptor.api,error:error.message});}
    }
    return {jobs,errors,atsSources:uniqueBy(descriptors,d=>`${d.provider}|${d.key}`).length};
  }
  cachedReport(){
    if(!this.cacheMs||!fs.existsSync(this.reportFile)||!fs.existsSync(this.outputFile))return null;
    try{const report=JSON.parse(fs.readFileSync(this.reportFile,"utf8"));const age=Date.now()-Date.parse(report.generatedAt||0);if(Number.isFinite(age)&&age>=0&&age<this.cacheMs)return {...report,status:"PUBLIC_JOB_SIGNALS_CACHED",cached:true};}catch{}
    return null;
  }
  async runOnce(){
    const cached=this.cachedReport(); if(cached)return cached;
    const generatedAt=new Date().toISOString(); const companies=this.companyUniverse();
    if(!companies.length){const report={ok:true,status:"PUBLIC_JOB_SOURCE_UNAVAILABLE",provider:"PUBLIC_ATS_AND_CAREERS",configured:false,companiesChecked:0,atsSources:0,usableSignals:0,outputFile:this.outputFile,generatedAt};report.artifact=this.writeJson(this.reportFile,report);return report;}
    const signals=[];const errors=[];let atsSources=0;
    for(const company of companies){const result=await this.scanCompany(company);signals.push(...result.jobs);errors.push(...result.errors.map(e=>({company:company.company,...e})));atsSources+=result.atsSources;}
    const rows=uniqueBy(signals,s=>`${s.company.toLowerCase()}|${s.trigger_type}|${s.source_url.toLowerCase()}`);
    this.writeJson(this.outputFile,{generatedAt,provider:"PUBLIC_ATS_AND_CAREERS",records:rows});
    const report={ok:true,status:rows.length?"PUBLIC_JOB_SIGNALS_REFRESHED":"PUBLIC_JOB_SIGNALS_NO_USABLE_SIGNALS",provider:"PUBLIC_ATS_AND_CAREERS",configured:true,companiesChecked:companies.length,atsSources,usableSignals:rows.length,errors:errors.slice(0,100),outputFile:this.outputFile,generatedAt};report.artifact=this.writeJson(this.reportFile,report);return report;
  }
}

module.exports=CaptureCapacityPublicWebSignalService;
module.exports.helpers={clean,normalizeSpace,stripHtml,classify,companyFromDomain,absoluteUrl,validHttpUrl,extractLinks,atsDescriptor,rowsFromFile};
