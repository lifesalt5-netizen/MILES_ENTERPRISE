'use strict';

const fs=require('fs');
const path=require('path');
const https=require('https');

function clean(v){return String(v??'').trim();}
function decode(v){return clean(v).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function stripHtml(v){return decode(v).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function tag(xml,name){const m=String(xml||'').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?decode(m[1]):'';}
function safeUrl(v){try{const u=new URL(clean(v));return ['http:','https:'].includes(u.protocol)?u:null;}catch{return null;}}
function parseRss(xml){return [...String(xml||'').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>({title:stripHtml(tag(m[1],'title')),url:clean(tag(m[1],'link')),snippet:stripHtml(tag(m[1],'description')),publishedAt:clean(tag(m[1],'pubDate'))}));}
function ageDays(date,now=Date.now()){const t=Date.parse(date);return Number.isFinite(t)?Math.floor((now-t)/86400000):null;}

const BUYING_LANGUAGE=[/\bneed help\b/i,/\blooking for (?:a |an )?(?:consultant|expert|help|partner|prime|subcontractor|proposal writer)\b/i,/\bhow (?:do|can) (?:i|we)\b/i,/\bnot getting (?:contracts|sales|awards|traction)\b/i,/\bno (?:sales|contracts|awards)\b/i,/\bwant to (?:become|win|find|get)\b/i,/\bhelp (?:with|us|me)\b/i];
const GOVCON_LANGUAGE=[/government contract/i,/govcon/i,/sam\.gov/i,/gsa schedule/i,/\bRFP\b/i,/\bRFQ\b/i,/\bRFI\b/i,/\bVA\b.{0,25}(?:contract|schedule|VISN)/i,/teaming/i,/subcontract/i,/federal contract/i];

class P2GCIntentPublicSearchService{
 constructor(options={}){
  this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||path.resolve(__dirname,'..','..'));
  this.configPath=options.configPath||path.join(this.rootDir,'CONFIG','p2gc_intent_public_search_queries.json');
  this.fetchText=options.fetchText||this.httpGet.bind(this);
  this.now=options.now||(()=>Date.now());
  this.maxSignalAgeDays=Math.max(1,Number(options.maxSignalAgeDays||45));
  this.maxResultsPerQuery=Math.max(1,Number(options.maxResultsPerQuery||10));
  this.verifyOriginal=options.verifyOriginal!==false;
  this.outputDir=options.outputDir||path.join(this.rootDir,'DATA','runtime','revenue','intent_leads');
  this.latestPath=path.join(this.outputDir,'latest_public_search_candidates.json');
 }
 config(){return JSON.parse(fs.readFileSync(this.configPath,'utf8').replace(/^\uFEFF/,''));}
 httpGet(url,timeoutMs=15000,maxBytes=1000000){return new Promise((resolve,reject)=>{const u=safeUrl(url);if(!u)return reject(new Error('INVALID_URL'));const req=https.get(u,{headers:{'user-agent':'Mozilla/5.0 P2GC-Public-Intent-Research/1.0','accept':'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.7'}},res=>{if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return resolve(this.httpGet(new URL(res.headers.location,u).toString(),timeoutMs,maxBytes));}if(res.statusCode!==200){res.resume();return reject(new Error(`HTTP_${res.statusCode}`));}const chunks=[];let total=0;res.on('data',c=>{total+=c.length;if(total<=maxBytes)chunks.push(c);if(total>maxBytes)req.destroy(new Error('RESPONSE_TOO_LARGE'));});res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));});req.setTimeout(timeoutMs,()=>req.destroy(new Error('REQUEST_TIMEOUT')));req.on('error',reject);});}
 searchUrl(query){return `https://www.bing.com/search?format=rss&count=${this.maxResultsPerQuery}&q=${encodeURIComponent(query)}`;}
 evidenceScore(text){const t=stripHtml(text);const buying=BUYING_LANGUAGE.some(r=>r.test(t));const govcon=GOVCON_LANGUAGE.some(r=>r.test(t));return {buying,govcon,qualified:buying&&govcon};}
 excerpt(text){const t=stripHtml(text);if(!t)return '';for(const re of BUYING_LANGUAGE){const m=re.exec(t);if(m){const start=Math.max(0,m.index-160),end=Math.min(t.length,m.index+Math.max(220,m[0].length+160));return t.slice(start,end).trim();}}return t.slice(0,400).trim();}
 async verifyCandidate(item,queryDef){
  const u=safeUrl(item.url);if(!u)return {...item,queryId:queryDef.id,signalType:queryDef.signalType,verificationStatus:'INVALID_SOURCE_URL',qualified:false};
  const publishedAge=ageDays(item.publishedAt,this.now());
  if(publishedAge!==null&&publishedAge>this.maxSignalAgeDays)return {...item,queryId:queryDef.id,signalType:queryDef.signalType,verificationStatus:'STALE_SEARCH_RESULT',qualified:false,publishedAgeDays:publishedAge};
  const snippetEvidence=this.evidenceScore(`${item.title} ${item.snippet}`);
  if(!this.verifyOriginal)return {...item,queryId:queryDef.id,signalType:queryDef.signalType,verificationStatus:'SEARCH_SNIPPET_ONLY',qualified:false,snippetEvidence};
  try{
   const html=await this.fetchText(item.url);const originalText=stripHtml(html);const evidence=this.evidenceScore(originalText);const exactExcerpt=this.excerpt(originalText);
   return {...item,queryId:queryDef.id,signalType:queryDef.signalType,sourcePlatform:u.hostname.replace(/^www\./,''),originalTextVerified:true,verificationStatus:evidence.qualified?'ORIGINAL_PUBLIC_SIGNAL_VERIFIED':'ORIGINAL_PAGE_NO_QUALIFYING_INTENT',qualified:evidence.qualified,needSummary:stripHtml(item.title||item.snippet).slice(0,500),excerpt:exactExcerpt,originalPostDate:item.publishedAt||null,evidence};
  }catch(error){return {...item,queryId:queryDef.id,signalType:queryDef.signalType,sourcePlatform:u.hostname.replace(/^www\./,''),originalTextVerified:false,verificationStatus:'ORIGINAL_PAGE_UNAVAILABLE',qualified:false,error:error.message,snippetEvidence};}
 }
 async discover(options={}){
  const cfg=this.config();const queries=Array.isArray(options.queries)?options.queries:(cfg.queries||[]);const candidates=[];const errors=[];
  for(const q of queries){
   try{const rss=await this.fetchText(this.searchUrl(q.query));const items=parseRss(rss).slice(0,this.maxResultsPerQuery);for(const item of items)candidates.push(await this.verifyCandidate(item,q));}
   catch(error){errors.push({queryId:q.id,error:error.message});}
  }
  const seen=new Set();const deduped=[];for(const c of candidates){const key=clean(c.url).toLowerCase();if(!key||seen.has(key))continue;seen.add(key);deduped.push(c);}
  const verified=deduped.filter(x=>x.qualified&&x.verificationStatus==='ORIGINAL_PUBLIC_SIGNAL_VERIFIED');
  const report={ok:errors.length<queries.length,service:'P2GC_INTENT_PUBLIC_SEARCH',provider:cfg.provider||'BING_RSS_PUBLIC_SEARCH',queriesAttempted:queries.length,errors,candidatesObserved:candidates.length,candidatesDeduped:deduped.length,verifiedIntentSignals:verified.length,verified,candidates:deduped,safety:{publicSourcesOnly:true,authenticatedScraping:false,outboundSendPerformed:false,searchSnippetAloneQualifiesLead:false,originalPublicSignalRequired:true},generatedAt:new Date(this.now()).toISOString()};
  fs.mkdirSync(this.outputDir,{recursive:true});fs.writeFileSync(this.latestPath,JSON.stringify(report,null,2),'utf8');return report;
 }
}
module.exports=P2GCIntentPublicSearchService;
module.exports.parseRss=parseRss;
module.exports.stripHtml=stripHtml;
