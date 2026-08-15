"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT = path.join(ROOT,"DATA","runtime_guardian");
const timeoutMs = Number(process.env.MILES_ACCEPTANCE_TIMEOUT_MS || 90000);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function request(method, route, body=null){
  return new Promise((resolve,reject)=>{
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({host:"127.0.0.1",port:8787,path:route,method,headers:payload?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(payload)}:{}}, res=>{
      let data=""; res.on("data",d=>data+=d); res.on("end",()=>{
        let parsed; try{ parsed=JSON.parse(data); }catch{ parsed=data; }
        resolve({statusCode:res.statusCode,data:parsed});
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error("request timeout")));
    req.on("error",reject); if(payload) req.write(payload); req.end();
  });
}
function pm2(){
  try { return JSON.parse(execSync("pm2 jlist",{cwd:ROOT,encoding:"utf8"})); } catch { return []; }
}
function syntheticText(value){ return /build[ _-]?e010|test company|example\.com|unknown target/i.test(JSON.stringify(value||{})); }

async function main(){
  const checks=[];
  const add=(name,ok,detail)=>checks.push({name,ok:Boolean(ok),detail});

  const apps=pm2();
  const expected=["miles-worker","miles-ui","miles-dashboard","miles-command-center"];
  add("four expected PM2 apps online", expected.every(n=>apps.some(a=>a.name===n&&a.pm2_env?.status==="online")), apps.map(a=>({name:a.name,status:a.pm2_env?.status,pid:a.pid,restarts:a.pm2_env?.restart_time})));

  const health=await request("GET","/api/health");
  add("8787 health responds", health.statusCode<500 && health.data, health.data);

  const dashboard=await request("GET","/api/dashboard");
  const deps=Array.isArray(dashboard.data?.departments)?dashboard.data.departments:[];
  add("8787 department dashboard returns all departments", dashboard.statusCode===200 && deps.length>=14, {count:deps.length,names:deps.map(d=>d.name)});
  add("department records contain live counts", deps.length>0 && deps.every(d=>["runningCount","queueCount","completedCount","failedCount","approvalCount"].some(k=>d[k]!==undefined)), deps.slice(0,3));

  const demo=await request("GET","/api/demo");
  add("demo truth endpoint healthy", demo.statusCode===200 && demo.data?.ok===true, demo.data?.headline||demo.data);
  add("demo excludes synthetic deals", demo.data?.revenue && !syntheticText(demo.data.revenue.deals), demo.data?.revenue?.deals||[]);
  add("demo exposes canonical truth rules", Array.isArray(demo.data?.truthRules)&&demo.data.truthRules.length>=4, demo.data?.truthRules||[]);

  const command="Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems.";
  const accepted=await request("POST","/api/command",{command});
  const taskId=accepted.data?.enqueueResult?.taskId;
  add("8787 command bridges to TaskQueue", accepted.statusCode===200 && accepted.data?.enqueueResult?.ok===true && Boolean(taskId), accepted.data?.enqueueResult||accepted.data);

  let result=null;
  if(taskId){
    const direct=path.join(ROOT,"DATA","workforce_results",`WP_${taskId}.json`);
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(fs.existsSync(direct)){ try{ result=JSON.parse(fs.readFileSync(direct,"utf8")); }catch{} if(result) break; }
      try{
        const dir=path.join(ROOT,"DATA","workforce_results");
        const match=fs.readdirSync(dir).find(n=>n.includes(taskId)&&n.endsWith(".json"));
        if(match){ result=JSON.parse(fs.readFileSync(path.join(dir,match),"utf8")); if(result) break; }
      }catch{}
      await sleep(2000);
    }
  }
  add("worker persists command result", Boolean(result), result?{taskId:result.taskId,status:result.status,ok:result.ok}:null);
  add("revenue result excludes synthetic test deals", result ? !syntheticText(result.output||result) : false, result?.output||null);

  const operationId=accepted.data?.operation?.id||accepted.data?.operationId;
  if(operationId){
    const polled=await request("GET","/api/operation?id="+encodeURIComponent(operationId));
    add("8787 operation polling sees persisted result", polled.statusCode===200 && (polled.data?.latestTask?.result || /Complete/i.test(String(polled.data?.message||""))), {status:polled.data?.status,latestTask:polled.data?.latestTask,message:polled.data?.message});
  }

  const ok=checks.every(c=>c.ok);
  const report={ok,type:"MILES_PRODUCTION_ACCEPTANCE",generatedAt:new Date().toISOString(),taskId,operationId,checks};
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,"production_acceptance_latest.json"),JSON.stringify(report,null,2),"utf8");
  console.log("=== MILES PRODUCTION ACCEPTANCE ===");
  for(const c of checks) console.log(`${c.ok?"PASS":"FAIL"} | ${c.name}`);
  console.log("RESULT:",ok?"PASS":"FAIL");
  console.log("REPORT:",path.join(OUT,"production_acceptance_latest.json"));
  process.exitCode=ok?0:1;
}

main().catch(err=>{console.error(err.stack||err.message);process.exitCode=1;});
