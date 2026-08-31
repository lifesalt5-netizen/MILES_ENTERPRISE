'use strict';

const fs=require('fs');
const path=require('path');

function now(){return new Date().toISOString();}
function safeStat(file){try{const s=fs.statSync(file);return{exists:true,isFile:s.isFile(),isDirectory:s.isDirectory(),bytes:s.size,mtime:s.mtime.toISOString()};}catch{return{exists:false,isFile:false,isDirectory:false,bytes:null,mtime:null};}}
function normalizeHeader(v){return String(v||'').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');}
function readHead(file,max=131072){const fd=fs.openSync(file,'r');try{const size=Math.min(max,fs.fstatSync(fd).size),b=Buffer.alloc(size);fs.readSync(fd,b,0,size,0);return b.toString('utf8');}finally{fs.closeSync(fd);}}
function firstLine(text){return String(text||'').split(/\r?\n/,1)[0]||'';}
function parseDelimitedHeader(line){const delimiter=(line.match(/\|/g)||[]).length>(line.match(/,/g)||[]).length?'|':',';return{delimiter,columns:line.split(delimiter).map(normalizeHeader).filter(Boolean)};}
function scoreColumns(columns=[]){const set=new Set(columns);const email=[...set].some(x=>/(^|_)email($|_)/.test(x));const uei=[...set].some(x=>x==='uei'||x.includes('unique_entity_identifier'));const cage=[...set].some(x=>x==='cage'||x.includes('cage_code'));const name=[...set].some(x=>['company','company_name','legal_name','legal_business_name','business_name','organization_name'].includes(x));const domain=[...set].some(x=>x.includes('domain')||x.includes('website'));return{email,uei,cage,name,domain,contactRecoveryCandidate:email&&(uei||cage||name||domain)};}
function relevantName(name){return /(sam|segment|lead|target|contact|email|verified|validated|million|campaign|prospect|contractor|master|dedup|suppression)/i.test(name);}
function allowedExt(name){return /\.(csv|tsv|txt|jsonl|json|db|sqlite|sqlite3)$/i.test(name);}

class SamContactRecoverySourceAuditService{
 constructor(options={}){
  this.rootDir=path.resolve(options.rootDir||process.env.MILES_ROOT||process.cwd());
  this.searchRoots=(options.searchRoots||[this.rootDir,path.resolve(this.rootDir,'..')]).map(path.resolve);
  this.maxDepth=Math.max(1,Number(options.maxDepth||5));
  this.maxFiles=Math.max(100,Number(options.maxFiles||6000));
  this.reportPath=path.join(this.rootDir,'DATA','orion_refresh','latest_sam_contact_recovery_source_audit.json');
 }
 walk(root,depth=0,out=[]){if(out.length>=this.maxFiles||depth>this.maxDepth)return out;let entries=[];try{entries=fs.readdirSync(root,{withFileTypes:true});}catch{return out;}for(const e of entries){if(out.length>=this.maxFiles)break;if(['node_modules','.git','logs','LOGS','archive','archives','backup','backups'].includes(e.name))continue;const p=path.join(root,e.name);if(e.isDirectory()){if(depth<this.maxDepth)this.walk(p,depth+1,out);continue;}if(!e.isFile()||!allowedExt(e.name)||!relevantName(e.name))continue;out.push(p);}return out;}
 inspectDelimited(file){try{const h=parseDelimitedHeader(firstLine(readHead(file)));const score=scoreColumns(h.columns);return{kind:'DELIMITED',delimiter:h.delimiter,columns:h.columns.slice(0,120),...score,error:null};}catch(e){return{kind:'DELIMITED',email:false,uei:false,cage:false,name:false,domain:false,contactRecoveryCandidate:false,error:e.message};}}
 inspectSqlite(file){let Database;try{Database=require('better-sqlite3');}catch{return{kind:'SQLITE',contactRecoveryCandidate:false,error:'BETTER_SQLITE3_UNAVAILABLE'};}let db;try{db=new Database(file,{readonly:true,fileMustExist:true});const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);const candidates=[];for(const table of tables.slice(0,200)){let cols=[];try{cols=db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(x=>normalizeHeader(x.name));}catch{continue;}const score=scoreColumns(cols);if(score.contactRecoveryCandidate)candidates.push({table,columns:cols.slice(0,120),...score});}return{kind:'SQLITE',tablesScanned:tables.length,candidates,contactRecoveryCandidate:candidates.length>0,error:null};}catch(e){return{kind:'SQLITE',contactRecoveryCandidate:false,error:e.message};}finally{try{db?.close();}catch{}}}
 run(){const seen=new Set(),files=[];for(const root of this.searchRoots){for(const file of this.walk(root)){const key=path.resolve(file).toLowerCase();if(seen.has(key))continue;seen.add(key);files.push(file);}}
  const inspected=[];for(const file of files){const stat=safeStat(file);if(!stat.isFile)continue;let detail;if(/\.(db|sqlite|sqlite3)$/i.test(file))detail=this.inspectSqlite(file);else if(/\.(csv|tsv|txt)$/i.test(file))detail=this.inspectDelimited(file);else detail={kind:'STRUCTURED_TEXT',contactRecoveryCandidate:false,error:null};inspected.push({file,stat,detail});}
  const candidates=inspected.filter(x=>x.detail?.contactRecoveryCandidate).sort((a,b)=>Number(b.detail.uei)-Number(a.detail.uei)||Number(b.stat.mtime>a.stat.mtime)-Number(a.stat.mtime>b.stat.mtime));
  const priorSam=candidates.filter(x=>/sam/i.test(path.basename(x.file)));const internal=candidates.filter(x=>!priorSam.includes(x));const result={ok:true,service:'SAM_CONTACT_RECOVERY_SOURCE_AUDIT',generatedAt:now(),searchRoots:this.searchRoots,filesConsidered:files.length,filesInspected:inspected.length,candidateCount:candidates.length,priorSamCandidateCount:priorSam.length,internalCandidateCount:internal.length,candidates:candidates.slice(0,250),nextStep:candidates.length?'BUILD_GOVERNED_EMAIL_RECOVERY_MATCH_PLAN':'USE_GOVERNED_ENRICHMENT_FOR_ALL_MISSING_EMAILS',safety:{readOnly:true,filesChanged:0,databasesModified:false,campaignsModified:false,credentialsRead:false,emailValuesRead:false,headersAndSchemaOnly:true,unboundedDiskScan:false,maxDepth:this.maxDepth,maxFiles:this.maxFiles}};
  fs.mkdirSync(path.dirname(this.reportPath),{recursive:true});fs.writeFileSync(this.reportPath,JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify(result,null,2));return result;
 }
}
module.exports=SamContactRecoverySourceAuditService;
module.exports.normalizeHeader=normalizeHeader;
module.exports.scoreColumns=scoreColumns;
