"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.env.MILES_ROOT || process.cwd();
const BASE = path.join(ROOT, "DATA", "chatgpt_bridge");
const DIRS = { pending:path.join(BASE,"pending"), active:path.join(BASE,"active"), completed:path.join(BASE,"completed"), failed:path.join(BASE,"failed"), results:path.join(BASE,"results") };
function ensureDirs(){ Object.values(DIRS).forEach(d=>fs.mkdirSync(d,{recursive:true})); }
function readJson(f){
  const text = fs.readFileSync(f,"utf8").replace(/^\uFEFF|^ï»¿/, "");
  return JSON.parse(text);
}
function writeJson(f,v){ fs.writeFileSync(f,JSON.stringify(v,null,2),"utf8"); }
function move(a,b){ fs.mkdirSync(path.dirname(b),{recursive:true}); fs.renameSync(a,b); }
function loadExecutor(){
  const candidates=[path.join(ROOT,"SERVICES","WorkflowService.js"),path.join(ROOT,"SERVICES","WorkPackageService.js")];
  for(const c of candidates){
    if(!fs.existsSync(c)) continue;
    const s=require(c);
    if(s&&typeof s.createWorkflow==="function") return {name:"WorkflowService",execute:(o,x)=>s.createWorkflow(o,x)};
    if(s&&typeof s.create==="function") return {name:"WorkPackageService",execute:(o,x)=>s.create(o,x)};
  }
  throw new Error("No compatible WorkflowService or WorkPackageService was found.");
}
class ChatGPTWorkPackageBridgeService{
  constructor(options={}){ this.pollMs=Math.max(1000,Number(options.pollMs||process.env.CHATGPT_BRIDGE_POLL_MS||3000)); this.timer=null; this.processing=false; this.executor=loadExecutor(); ensureDirs(); }
  normalize(input,sourceFile){
    const objective=String(input.objective||input.instruction||input.command||input.title||"").trim();
    if(!objective) throw new Error("Work package requires objective, instruction, or command.");
    return { id:String(input.id||"").trim()||`CGPT-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, source:"CHATGPT", title:String(input.title||objective).trim(), objective, priority:input.priority||"HIGH", requiresCEOApproval:Boolean(input.requiresCEOApproval), context:{...(input.context||{}),source:"CHATGPT",requestedBy:input.requestedBy||"Kevin",twins:Array.isArray(input.twins)?input.twins:[],successCriteria:Array.isArray(input.successCriteria)?input.successCriteria:[],constraints:Array.isArray(input.constraints)?input.constraints:[],originalWorkPackage:input,sourceFile}, submittedAt:input.submittedAt||new Date().toISOString() };
  }
  async processFile(file){
    const name=path.basename(file), active=path.join(DIRS.active,name); move(file,active); let n=null; const startedAt=new Date().toISOString();
    try{
      n=this.normalize(readJson(active),name);
      const context={...n.context,externalWorkPackageId:n.id,priority:n.priority,approvalRequired:n.requiresCEOApproval};
      const milesResult=await Promise.resolve(this.executor.execute(n.objective,context));
      const status=milesResult?.status||milesResult?.workPackage?.status||"QUEUED";
      const receipt={ok:true,bridgeStatus:"ACCEPTED_BY_MILES",id:n.id,title:n.title,objective:n.objective,executor:this.executor.name,milesStatus:status,milesResult,submittedAt:n.submittedAt,startedAt,acceptedAt:new Date().toISOString()};
      writeJson(path.join(DIRS.results,`${n.id}.json`),receipt); move(active,path.join(DIRS.completed,name));
      console.log(`[CHATGPT BRIDGE] ${n.id} accepted by ${this.executor.name}; status=${status}`); return receipt;
    }catch(error){
      const id=n?.id||path.parse(name).name; const failure={ok:false,bridgeStatus:"FAILED",id,sourceFile:name,startedAt,failedAt:new Date().toISOString(),error:error?.stack||String(error)};
      writeJson(path.join(DIRS.results,`${id}.json`),failure); if(fs.existsSync(active)) move(active,path.join(DIRS.failed,name)); console.error(`[CHATGPT BRIDGE] ${id} failed:`,error.message); return failure;
    }
  }
  async runOnce(){
    if(this.processing) return {ok:true,skipped:true,reason:"PROCESSING"}; this.processing=true;
    try{ ensureDirs(); const files=fs.readdirSync(DIRS.pending).filter(n=>n.toLowerCase().endsWith(".json")).sort().map(n=>path.join(DIRS.pending,n)); const results=[]; for(const f of files) results.push(await this.processFile(f)); return {ok:results.every(r=>r.ok),processed:results.length,results}; }
    finally{ this.processing=false; }
  }
  start(){
    if(this.timer) return; console.log("[CHATGPT BRIDGE] Running",{root:ROOT,pending:DIRS.pending,pollMs:this.pollMs,executor:this.executor.name});
    this.runOnce().catch(e=>console.error("[CHATGPT BRIDGE] Initial run failed:",e));
    this.timer=setInterval(()=>this.runOnce().catch(e=>console.error("[CHATGPT BRIDGE] Poll failed:",e)),this.pollMs);
  }
  stop(){ if(this.timer){clearInterval(this.timer);this.timer=null;} }
  health(){ ensureDirs(); const count=d=>fs.readdirSync(d).filter(f=>f.endsWith(".json")).length; return {ok:true,status:this.timer?"RUNNING":"READY",executor:this.executor.name,pollMs:this.pollMs,pending:count(DIRS.pending),active:count(DIRS.active),completed:count(DIRS.completed),failed:count(DIRS.failed),results:count(DIRS.results)}; }
}
module.exports=ChatGPTWorkPackageBridgeService;



