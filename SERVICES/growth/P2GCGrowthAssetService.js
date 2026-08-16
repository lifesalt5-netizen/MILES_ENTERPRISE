"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const ROOT=process.env.MILES_ROOT||path.resolve(__dirname,"..","..");
const DIR=process.env.P2GC_GROWTH_ASSET_DIR||path.join(ROOT,"DATA","growth_assets");
const FILE=path.join(DIR,"state.json");
function now(){return new Date().toISOString();}
function id(p){return `${p}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;}
function arr(v){return Array.isArray(v)?v:[];}
function clean(v){return v==null?null:String(v).trim();}
function state0(){return{version:1,generatedAt:now(),proposalLibrary:[],knowledgeBase:[],socialPosts:[],newsletters:[],caseStudies:[],leadMagnets:[],websiteBacklog:[]};}
function read(){try{return JSON.parse(fs.readFileSync(FILE,"utf8").replace(/^\uFEFF/,""));}catch{return state0();}}
function save(s){fs.mkdirSync(DIR,{recursive:true});s.generatedAt=now();const tmp=`${FILE}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(s,null,2));try{fs.renameSync(tmp,FILE)}catch{fs.copyFileSync(tmp,FILE);try{fs.unlinkSync(tmp)}catch{}}return s;}
function collection(s,name){if(!Object.prototype.hasOwnProperty.call(s,name)||!Array.isArray(s[name]))throw new Error(`Unknown collection: ${name}`);return s[name];}

class P2GCGrowthAssetService{
 constructor(){fs.mkdirSync(DIR,{recursive:true});if(!fs.existsSync(FILE))save(state0());}
 healthCheck(){const s=read();return{ok:true,status:"HEALTHY",service:"P2GC_GROWTH_ASSETS",generatedAt:now(),counts:Object.fromEntries(Object.keys(state0()).filter(k=>Array.isArray(s[k])).map(k=>[k,arr(s[k]).length])),publishing:{linkedin:false,b12:false,emailNewsletter:false,status:"FAIL_CLOSED_UNTIL_EXTERNAL_PUBLISHERS_CONFIGURED"}};}
 add(kind,input={}){const s=read();const list=collection(s,kind);const r={id:clean(input.id)||id(kind),title:clean(input.title)||clean(input.name)||"Untitled",status:clean(input.status)||"DRAFT",audience:clean(input.audience),body:clean(input.body)||clean(input.content),url:clean(input.url),tags:arr(input.tags),source:clean(input.source)||"MILES",createdAt:now(),updatedAt:now(),externalPublished:false};list.push(r);save(s);return{ok:true,item:r};}
 update(kind,itemId,patch={}){const s=read();const r=collection(s,kind).find(x=>x.id===itemId);if(!r)return{ok:false,status:"NOT_FOUND"};for(const k of ["title","status","audience","body","url","tags"]){if(Object.prototype.hasOwnProperty.call(patch,k))r[k]=k==="tags"?arr(patch[k]):clean(patch[k]);}r.updatedAt=now();save(s);return{ok:true,item:r};}
 list(kind){const s=read();return{ok:true,items:collection(s,kind)};}
 queueSocial(input={}){return this.add("socialPosts",{...input,status:input.status||"READY_FOR_APPROVAL"});}
 queueWebsite(input={}){return this.add("websiteBacklog",{...input,status:input.status||"READY_FOR_APPROVAL"});}
 publish(kind,itemId){const s=read();const r=collection(s,kind).find(x=>x.id===itemId);if(!r)return{ok:false,status:"NOT_FOUND"};return{ok:false,status:"BLOCKED_EXTERNAL_PUBLISHER",item:r,externalPublished:false,reason:"External publishing is intentionally fail-closed until governed LinkedIn/B12/newsletter credentials are configured."};}
 search(term){const s=read();const q=String(term||"").trim().toLowerCase();const results=[];for(const kind of ["proposalLibrary","knowledgeBase","socialPosts","newsletters","caseStudies","leadMagnets","websiteBacklog"]){for(const item of arr(s[kind])){if(!q||JSON.stringify(item).toLowerCase().includes(q))results.push({kind,item});}}return{ok:true,query:q,results};}
 dashboard(){const s=read();return{ok:true,status:"READY",generatedAt:now(),metrics:{proposalLibrary:arr(s.proposalLibrary).length,knowledgeBase:arr(s.knowledgeBase).length,socialReady:arr(s.socialPosts).filter(x=>/READY|APPROVED/.test(x.status)).length,newsletters:arr(s.newsletters).length,caseStudies:arr(s.caseStudies).length,leadMagnets:arr(s.leadMagnets).length,websiteBacklog:arr(s.websiteBacklog).length},publishing:this.healthCheck().publishing};}
}
module.exports=new P2GCGrowthAssetService();
