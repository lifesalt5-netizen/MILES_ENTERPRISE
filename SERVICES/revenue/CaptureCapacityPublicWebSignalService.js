"use strict";

const fs = require("fs");
const path = require("path");

const ENGINE_VERSION = "PUBLIC_JOB_DISCOVERY_V3";
const ROLE_PATTERN = /\b(capture manager|capture director|capture lead|capture analyst|capture executive|business development manager|business development director|bd manager|bd director|growth manager|growth director|growth executive|proposal manager|proposal director|proposal lead|proposal writer|proposal development|federal pricing analyst|pricing analyst|price[- ]to[- ]win)\b/i;
const CAREER_LINK_PATTERN = /\b(careers?|jobs?|employment|join(?:\s+our)?\s+team|join\s+us|work\s+with\s+us|opportunities)\b/i;
const DEFAULT_MAX_COMPANIES = 25;
const DEFAULT_CACHE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 4;
const FREE_EMAIL_HOSTS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "comcast.net", "verizon.net", "att.net"
]);
const NON_COMPANY_HOSTS = new Set([
  ...FREE_EMAIL_HOSTS,
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
  "google.com", "bing.com", "sam.gov", "usaspending.gov"
]);
const COMMON_CAREER_PATHS = ["/careers", "/jobs", "/career", "/employment", "/join-us", "/work-with-us", "/opportunities"];

function clean(value) { return String(value ?? "").trim(); }
function normalizeSpace(value) { return clean(value).replace(/\s+/g, " "); }
function stripHtml(value) { return normalizeSpace(String(value || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"')); }
function classify(text) {
  const value = String(text || "").toLowerCase();
  if (/capture manager|capture director|capture lead|capture analyst|capture executive/.test(value)) return "CAPTURE_HIRING";
  if (/business development manager|business development director|bd manager|bd director|growth manager|growth director|growth executive|proposal manager|proposal director|proposal lead|proposal writer|proposal development|federal pricing analyst|pricing analyst|price[- ]to[- ]win/.test(value)) return "BD_CAPTURE_OPENING";
  return null;
}
function validHttpUrl(value) { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol); } catch { return false; } }
function hostOf(value) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
function normalizeWebsite(value) {
  const raw = clean(value);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!validHttpUrl(candidate)) return "";
  try {
    const u = new URL(candidate);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch { return ""; }
}
function usableCompanyWebsite(value) {
  const normalized = normalizeWebsite(value);
  if (!normalized) return false;
  const host = hostOf(normalized);
  if (!host || NON_COMPANY_HOSTS.has(host)) return false;
  if (/\.(gov|mil)$/i.test(host)) return false;
  return true;
}
function companyFromDomain(value) {
  const host = hostOf(normalizeWebsite(value));
  const stem = host.split(".")[0] || "";
  return stem.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function absoluteUrl(base, href) { try { return new URL(href, base).toString(); } catch { return ""; } }
function uniqueBy(items, keyFn) { const map = new Map(); for (const item of items) { const key = keyFn(item); if (key && !map.has(key)) map.set(key, item); } return [...map.values()]; }
function parseCsvLine(line) { const out=[]; let field="",quoted=false; for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){out.push(field);field="";}else field+=ch;}out.push(field);return out; }
function rowsFromFile(file) {
  const ext=path.extname(file).toLowerCase(); const text=fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"");
  if(ext===".json"){const x=JSON.parse(text);if(Array.isArray(x))return x;for(const k of ["rows","records","results","data","contacts","leads","candidates"])if(Array.isArray(x?.[k]))return x[k];return x&&typeof x==="object"?[x]:[];}
  if(ext===".jsonl"||ext===".ndjson")return text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  if(ext===".csv"){const lines=text.split(/\r?\n/).filter(Boolean);if(lines.length<2)return[];const headers=parseCsvLine(lines.shift()).map(clean);return lines.map(line=>{const vals=parseCsvLine(line);return Object.fromEntries(headers.map((h,i)=>[h,vals[i]??""]));});}
  return [];
}
function first(record, keys) { for (const key of keys) if (clean(record?.[key])) return clean(record[key]); return ""; }
function extractLinks(html, base) {
  const links=[]; const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(String(html||"")))){const url=absoluteUrl(base,m[1]);if(url)links.push({url,text:stripHtml(m[2])});}
  return links;
}
function extractJsonLdJobs(html, base) {
  const jobs=[]; const re=/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  const collect = value => {
    if (!value) return;
    if (Array.isArray(value)) { for (const item of value) collect(item); return; }
    if (typeof value !== "object") return;
    const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : clean(value["@type"]);
    if (/JobPosting/i.test(type)) jobs.push({
      title: clean(value.title || value.name),
      description: clean(value.description),
      postedDate: clean(value.datePosted),
      url: absoluteUrl(base, value.url || value.mainEntityOfPage || base)
    });
    if (value["@graph"]) collect(value["@graph"]);
  };
  while ((m=re.exec(String(html||"")))) { try { collect(JSON.parse(m[1])); } catch {} }
  return jobs;
}
function atsDescriptor(url) {
  const value=clean(url); let m;
  if((m=value.match(/https?:\/\/(?:jobs\.)?lever\.co\/([^/?#]+)/i)))return{provider:"LEVER",key:m[1],api:`https://api.lever.co/v0/postings/${m[1]}?mode=json`};
  if((m=value.match(/https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/i)))return{provider:"GREENHOUSE",key:m[1],api:`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs?content=true`};
  if((m=value.match(/https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i)))return{provider:"ASHBY",key:m[1],api:`https://api.ashbyhq.com/posting-api/job-board/${m[1]}`};
  if(/\.applytojob\.com\//i.test(value))return{provider:"APPLYTOJOB",key:value,api:value};
  return null;
}
function careerLink(link, companyHost) {
  const host=hostOf(link.url); if(!host)return false;
  const text=`${link.text} ${link.url}`;
  return host===companyHost && CAREER_LINK_PATTERN.test(text);
}
function domainAffinity(company, website) {
  const host=hostOf(website).split(".")[0].replace(/[^a-z0-9]/g,"");
  const tokens=clean(company).toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>=4 && !/^(inc|llc|corp|corporation|company|group|services|solutions|systems|international)$/.test(t));
  return tokens.some(t=>host.includes(t.slice(0,Math.min(t.length,8)))) ? 1 : 0;
}
function rankCompany(row) {
  let score=0;
  if(row.explicitCareer)score+=10000;
  if(row.universeSource==="ORION_CONTRACTORS")score+=300;
  if(row.universeSource==="CONTACT_SOURCES")score+=100;
  if(row.uei)score+=50;
  score+=Math.min(200,Number(row.recompeteCount||0)*20);
  score+=domainAffinity(row.company,row.website)*30;
  return score;
}
async function mapLimit(items, limit, worker) {
  const results=new Array(items.length); let cursor=0;
  const runners=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=cursor++;if(i>=items.length)return;results[i]=await worker(items[i],i);}});
  await Promise.all(runners); return results;
}

class CaptureCapacityPublicWebSignalService {
  constructor(options={}) {
    this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,"..",".."));
    this.fetchImpl=options.fetchImpl||global.fetch;
    this.maxCompanies=Math.max(1,Math.min(100,Number(options.maxCompanies||process.env.CAPTURE_CAPACITY_PUBLIC_MAX_COMPANIES||DEFAULT_MAX_COMPANIES)));
    this.cacheMs=Math.max(0,Number(options.cacheMs ?? process.env.CAPTURE_CAPACITY_PUBLIC_CACHE_MS ?? DEFAULT_CACHE_MS));
    this.timeoutMs=Math.max(1000,Number(options.timeoutMs||DEFAULT_TIMEOUT_MS));
    this.concurrency=Math.max(1,Math.min(8,Number(options.concurrency||process.env.CAPTURE_CAPACITY_PUBLIC_CONCURRENCY||DEFAULT_CONCURRENCY)));
    this.contactSources=options.contactSources||null;
    this.explicitCareerUrls=options.careerUrls||null;
    this.useOrion=options.useOrion!==false;
    this.orion=options.orion||null;
    this.outputFile=options.outputFile||path.join(this.rootDir,"DATA","runtime","revenue","capture_capacity","signals","public_web_signals_latest.json");
    this.reportFile=options.reportFile||path.join(this.rootDir,"DATA","runtime","revenue","capture_capacity","public_web_signal_search_latest.json");
    this.universeMeta={engineVersion:ENGINE_VERSION,contactCandidates:0,contactRejectedDomains:0,orionCandidates:0,orionRejectedDomains:0,orionTotalWithWebsite:0,orionOffset:0,nextOrionOffset:0,orionStatus:this.useOrion?"NOT_EVALUATED":"DISABLED"};
  }
  writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.${Date.now()}.tmp`;fs.writeFileSync(temp,JSON.stringify(value,null,2),"utf8");fs.renameSync(temp,file);return file;}
  configuredContactSources(){if(Array.isArray(this.contactSources))return this.contactSources;return clean(process.env.CAPTURE_CAPACITY_CONTACT_SOURCES).split(path.delimiter).map(clean).filter(Boolean);}
  configuredCareerUrls(){if(Array.isArray(this.explicitCareerUrls))return this.explicitCareerUrls;return clean(process.env.CAPTURE_CAPACITY_PUBLIC_CAREER_URLS).split(path.delimiter).map(clean).filter(Boolean);}
  getOrion(){if(!this.useOrion)return null;if(this.orion)return this.orion;try{this.orion=require("../../CONNECTORS/ORION/connector");return this.orion;}catch{return null;}}
  priorOrionOffset(){try{if(!fs.existsSync(this.reportFile))return 0;const report=JSON.parse(fs.readFileSync(this.reportFile,"utf8"));if(report.engineVersion!==ENGINE_VERSION)return 0;return Math.max(0,Number(report?.universe?.nextOrionOffset||0));}catch{return 0;}}
  loadOrionCompanies(limit){
    if(!this.useOrion||limit<=0)return[];
    const orion=this.getOrion();if(!orion){this.universeMeta.orionStatus="ORION_CONNECTOR_UNAVAILABLE";return[];}
    try{
      const init=orion.initialize();if(!init?.ok){this.universeMeta.orionStatus="ORION_UNAVAILABLE";return[];}
      const contractorSchema=orion.query("PRAGMA table_info(contractors)",[]);const cols=new Set((Array.isArray(contractorSchema)?contractorSchema:[]).map(r=>clean(r.name)));
      if(!cols.has("website")||(!cols.has("company")&&!cols.has("company_norm"))){this.universeMeta.orionStatus="ORION_CONTRACTOR_IDENTITY_COLUMNS_MISSING";return[];}
      let recompeteJoin=false;
      try{const s=orion.query("PRAGMA table_info(recompetes)",[]);const rc=new Set((Array.isArray(s)?s:[]).map(r=>clean(r.name)));recompeteJoin=cols.has("id")&&rc.has("company_id");}catch{}
      const companyExpr=cols.has("company")?"c.company":"c.company_norm";const ueiExpr=cols.has("uei")?"c.uei":"''";const idExpr=cols.has("id")?"c.id":"c.rowid";
      const countRows=orion.query("SELECT COUNT(*) AS count FROM contractors WHERE website IS NOT NULL AND TRIM(website) <> ''",[]);const total=Math.max(0,Number(countRows?.[0]?.count||0));
      this.universeMeta.orionTotalWithWebsite=total;if(!total){this.universeMeta.orionStatus="ORION_NO_CONTRACTOR_WEBSITES";return[];}
      const requestedOffset=this.priorOrionOffset();const offset=requestedOffset>=total?0:requestedOffset;const scanLimit=Math.max(limit,Math.min(total,limit*5));
      const scoreExpr=recompeteJoin?"(SELECT COUNT(*) FROM recompetes r WHERE r.company_id = c.id)":"0";
      const rows=orion.query(`SELECT ${companyExpr} AS company, ${ueiExpr} AS uei, c.website AS website, ${scoreExpr} AS recompete_count FROM contractors c WHERE c.website IS NOT NULL AND TRIM(c.website) <> '' ORDER BY ${scoreExpr} DESC, ${idExpr} LIMIT ? OFFSET ?`,[scanLimit,offset]);
      const out=[];for(const record of Array.isArray(rows)?rows:[]){const company=clean(record.company);const website=normalizeWebsite(record.website);if(!company||!usableCompanyWebsite(website)){this.universeMeta.orionRejectedDomains+=1;continue;}out.push({company,website,uei:clean(record.uei),recompeteCount:Number(record.recompete_count||0),universeSource:"ORION_CONTRACTORS"});if(out.length>=limit)break;}
      out.sort((a,b)=>rankCompany(b)-rankCompany(a));this.universeMeta.orionCandidates=out.length;this.universeMeta.orionOffset=offset;this.universeMeta.nextOrionOffset=total?((offset+scanLimit)%total):0;this.universeMeta.orionStatus="ORION_CONTRACTOR_UNIVERSE_READY";return out;
    }catch(error){this.universeMeta.orionStatus="ORION_CONTRACTOR_UNIVERSE_FAILED";this.universeMeta.orionError=error.message;return[];}
  }
  contactCompanies(){
    const rows=[];
    for(const file of this.configuredContactSources()){
      if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
      try{for(const record of rowsFromFile(file)){
        const company=first(record,["company","company_name","companyName","legal_business_name","organization","vendor_name"]);let website=first(record,["website","company_website","company_url","url","domain"]);const email=first(record,["email","work_email","contact_email"]);let derivedFromEmail=false;
        if(!website&&email.includes("@")){const emailHost=email.split("@").pop().toLowerCase();if(!FREE_EMAIL_HOSTS.has(emailHost)){website=emailHost;derivedFromEmail=true;}}
        website=normalizeWebsite(website);if(!company||!usableCompanyWebsite(website)){if(company&&(website||email))this.universeMeta.contactRejectedDomains+=1;continue;}
        rows.push({company,website,derivedFromEmail,universeSource:"CONTACT_SOURCES"});
      }}catch{}
    }
    const unique=uniqueBy(rows,item=>hostOf(item.website));unique.sort((a,b)=>rankCompany(b)-rankCompany(a));this.universeMeta.contactCandidates=unique.length;return unique;
  }
  companyUniverse(){
    const explicit=[];for(const url of this.configuredCareerUrls()){const website=normalizeWebsite(url);if(validHttpUrl(website))explicit.push({company:companyFromDomain(website),website,explicitCareer:true,universeSource:"EXPLICIT_CAREER_URL"});}
    const contacts=this.contactCompanies();const reservedExplicit=Math.min(explicit.length,this.maxCompanies);const remaining=Math.max(0,this.maxCompanies-reservedExplicit);const orionBudget=this.useOrion?Math.max(0,Math.ceil(remaining*0.75)):0;const contactBudget=Math.max(0,remaining-orionBudget);const orionRows=this.loadOrionCompanies(orionBudget);
    const selected=[...explicit.slice(0,reservedExplicit),...orionRows,...contacts.slice(0,contactBudget)];
    if(selected.length<this.maxCompanies){const hosts=new Set(selected.map(r=>hostOf(r.website)));for(const row of contacts){const h=hostOf(row.website);if(hosts.has(h))continue;selected.push(row);hosts.add(h);if(selected.length>=this.maxCompanies)break;}}
    return uniqueBy(selected,item=>hostOf(item.website)).sort((a,b)=>rankCompany(b)-rankCompany(a)).slice(0,this.maxCompanies);
  }
  async fetchResponse(url,{json=false}={}){
    if(!this.fetchImpl)throw new Error("Global fetch is unavailable");const controller=typeof AbortController!=="undefined"?new AbortController():null;const timer=controller?setTimeout(()=>controller.abort(),this.timeoutMs):null;
    try{const response=await this.fetchImpl(url,{method:"GET",headers:{"User-Agent":"MILES-P2GC-Public-Signal-Monitor/1.1","Accept":json?"application/json":"text/html,application/json;q=0.9,*/*;q=0.5"},signal:controller?.signal});if(!response||response.ok!==true)throw new Error(`HTTP ${response?.status||"NO_STATUS"}`);return json?await response.json():await response.text();}finally{if(timer)clearTimeout(timer);}
  }
  normalizeJob({company,title,description,url,postedDate="",provider,universeSource=""}){const t=normalizeSpace(title);const evidence=stripHtml(description||title);const trigger=classify(`${t} ${evidence}`);if(!company||!url||!ROLE_PATTERN.test(`${t} ${evidence}`)||!trigger)return null;return{company,trigger_type:trigger,title:t,evidence:normalizeSpace(`${t}. ${evidence}`).slice(0,1800),source_url:url,posted_date:clean(postedDate),source_provider:provider,source_type:"PUBLIC_CAREER_OR_ATS",universe_source:universeSource,retrieved_at:new Date().toISOString(),evidence_status:"PUBLIC_SOURCE_DISCOVERED_REQUIRES_STANDARD_IDENTITY_GATE"};}
  async jobsFromAts(companyRow,descriptor){
    const jobs=[];const company=companyRow.company;const universeSource=companyRow.universeSource||"";
    if(descriptor.provider==="LEVER"){const payload=await this.fetchResponse(descriptor.api,{json:true});for(const row of Array.isArray(payload)?payload:[]){const job=this.normalizeJob({company,title:row.text,description:[row.descriptionPlain,row.additionalPlain].filter(Boolean).join(" "),url:row.hostedUrl||row.applyUrl,provider:"LEVER",universeSource});if(job)jobs.push(job);}}
    else if(descriptor.provider==="GREENHOUSE"){const payload=await this.fetchResponse(descriptor.api,{json:true});for(const row of Array.isArray(payload?.jobs)?payload.jobs:[]){const job=this.normalizeJob({company,title:row.title,description:row.content,url:row.absolute_url,postedDate:row.updated_at,provider:"GREENHOUSE",universeSource});if(job)jobs.push(job);}}
    else if(descriptor.provider==="ASHBY"){const payload=await this.fetchResponse(descriptor.api,{json:true});for(const row of Array.isArray(payload?.jobs)?payload.jobs:[]){const job=this.normalizeJob({company,title:row.title,description:[row.descriptionPlain,row.descriptionHtml].filter(Boolean).join(" "),url:row.jobUrl||row.applyUrl,postedDate:row.publishedAt,provider:"ASHBY",universeSource});if(job)jobs.push(job);}}
    else if(descriptor.provider==="APPLYTOJOB"){const html=await this.fetchResponse(descriptor.api);for(const link of extractLinks(html,descriptor.api))if(ROLE_PATTERN.test(link.text)){const job=this.normalizeJob({company,title:link.text,description:link.text,url:link.url,provider:"APPLYTOJOB",universeSource});if(job)jobs.push(job);}for(const raw of extractJsonLdJobs(html,descriptor.api)){const job=this.normalizeJob({company,...raw,provider:"APPLYTOJOB",universeSource});if(job)jobs.push(job);}if(!jobs.length&&ROLE_PATTERN.test(stripHtml(html))){const title=(stripHtml(html).match(ROLE_PATTERN)||[])[0]||"GovCon growth opening";const job=this.normalizeJob({company,title,description:stripHtml(html).slice(0,1800),url:descriptor.api,provider:"APPLYTOJOB",universeSource});if(job)jobs.push(job);}}
    return jobs;
  }
  async scanCompany(companyRow){
    const {company,website}=companyRow;const errors=[];const jobs=[];const descriptors=[];const pages=[];const seenPages=new Set();const companyHost=hostOf(website);let fetchedPages=0;let careerPagesDiscovered=0;
    const enqueue=url=>{const normalized=normalizeWebsite(url);if(normalized&&!seenPages.has(normalized)&&seenPages.size<10){seenPages.add(normalized);pages.push(normalized);}};
    if(companyRow.explicitCareer)enqueue(website);else{enqueue(website);for(const suffix of COMMON_CAREER_PATHS.slice(0,3))enqueue(absoluteUrl(website,suffix));}
    while(pages.length&&fetchedPages<6){const pageUrl=pages.shift();try{const direct=atsDescriptor(pageUrl);if(direct){descriptors.push(direct);continue;}const html=await this.fetchResponse(pageUrl);fetchedPages+=1;for(const raw of extractJsonLdJobs(html,pageUrl)){const job=this.normalizeJob({company,...raw,provider:"COMPANY_JSONLD",universeSource:companyRow.universeSource});if(job)jobs.push(job);}const links=extractLinks(html,pageUrl);for(const link of links){const descriptor=atsDescriptor(link.url);if(descriptor)descriptors.push(descriptor);if(careerLink(link,companyHost)){careerPagesDiscovered+=1;enqueue(link.url);}if(ROLE_PATTERN.test(link.text)){const job=this.normalizeJob({company,title:link.text,description:link.text,url:link.url,provider:"COMPANY_CAREERS",universeSource:companyRow.universeSource});if(job)jobs.push(job);}}}catch(error){errors.push({url:pageUrl,error:error.message});}}
    for(const descriptor of uniqueBy(descriptors,d=>`${d.provider}|${d.key}`)){try{jobs.push(...await this.jobsFromAts(companyRow,descriptor));}catch(error){errors.push({provider:descriptor.provider,url:descriptor.api,error:error.message});}}
    return{jobs,errors,atsSources:uniqueBy(descriptors,d=>`${d.provider}|${d.key}`).length,pagesFetched:fetchedPages,careerPagesDiscovered};
  }
  cachedReport(){if(!this.cacheMs||!fs.existsSync(this.reportFile)||!fs.existsSync(this.outputFile))return null;try{const report=JSON.parse(fs.readFileSync(this.reportFile,"utf8"));if(report.engineVersion!==ENGINE_VERSION)return null;const age=Date.now()-Date.parse(report.generatedAt||0);if(Number.isFinite(age)&&age>=0&&age<this.cacheMs)return{...report,status:"PUBLIC_JOB_SIGNALS_CACHED",cached:true};}catch{}return null;}
  async runOnce(){
    const cached=this.cachedReport();if(cached)return cached;const generatedAt=new Date().toISOString();const companies=this.companyUniverse();
    if(!companies.length){const report={ok:true,engineVersion:ENGINE_VERSION,status:"PUBLIC_JOB_SOURCE_UNAVAILABLE",provider:"PUBLIC_ATS_AND_CAREERS",configured:false,companiesChecked:0,atsSources:0,usableSignals:0,universe:this.universeMeta,outputFile:this.outputFile,generatedAt};report.artifact=this.writeJson(this.reportFile,report);return report;}
    const results=await mapLimit(companies,this.concurrency,company=>this.scanCompany(company));const signals=[];const errors=[];let atsSources=0,pagesFetched=0,careerPagesDiscovered=0;
    results.forEach((result,i)=>{const company=companies[i];signals.push(...result.jobs);errors.push(...result.errors.map(e=>({company:company.company,universeSource:company.universeSource,...e})));atsSources+=result.atsSources;pagesFetched+=result.pagesFetched;careerPagesDiscovered+=result.careerPagesDiscovered;});
    const rows=uniqueBy(signals,s=>`${s.company.toLowerCase()}|${s.trigger_type}|${s.source_url.toLowerCase()}`);this.writeJson(this.outputFile,{engineVersion:ENGINE_VERSION,generatedAt,provider:"PUBLIC_ATS_AND_CAREERS",universe:this.universeMeta,records:rows});
    const report={ok:true,engineVersion:ENGINE_VERSION,status:rows.length?"PUBLIC_JOB_SIGNALS_REFRESHED":"PUBLIC_JOB_SIGNALS_NO_USABLE_SIGNALS",provider:"PUBLIC_ATS_AND_CAREERS",configured:true,companiesChecked:companies.length,pagesFetched,careerPagesDiscovered,atsSources,usableSignals:rows.length,universe:this.universeMeta,selectedCompanies:companies.map(c=>({company:c.company,website:c.website,source:c.universeSource,recompeteCount:Number(c.recompeteCount||0)})),errors:errors.slice(0,100),outputFile:this.outputFile,generatedAt};report.artifact=this.writeJson(this.reportFile,report);return report;
  }
}

module.exports=CaptureCapacityPublicWebSignalService;
module.exports.ENGINE_VERSION=ENGINE_VERSION;
module.exports.helpers={clean,normalizeSpace,stripHtml,classify,companyFromDomain,absoluteUrl,validHttpUrl,hostOf,normalizeWebsite,usableCompanyWebsite,extractLinks,extractJsonLdJobs,atsDescriptor,careerLink,domainAffinity,rankCompany,rowsFromFile,FREE_EMAIL_HOSTS};
