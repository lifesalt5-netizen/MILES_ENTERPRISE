"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = process.env.MILES_ROOT || process.cwd();
const COMMAND_CENTER_FILE = path.join(ROOT, "SERVICES", "digital_coo", "MilesCommandCenter.js");

const checks = [
  { name: "MILES API", port: 3000, path: "/", expect: value => /MILES OS is running/i.test(value.text) },
  { name: "Command Center health", port: 8787, path: "/api/health", maxMs: 5000, expect: value => value.json?.ok === true && value.json?.taskQueue?.lockFree === true },
  { name: "Command Center dashboard", port: 8787, path: "/api/dashboard", maxMs: 5000, expect: value => value.json?.ok === true && value.json?.taskQueue?.lockFree === true },
  { name: "CEO Dashboard state", port: 8737, path: "/api/state", expect: value => Boolean(value.json) },
  { name: "CEO product launchpad", port: 8737, path: "/", expect: value => /P2GC Product Launchpad/i.test(value.text) && /Open Full Prospect Blueprint/i.test(value.text) && /Open Sub2Prime/i.test(value.text) && /Open Opportunity Intelligence/i.test(value.text) && /Open Vehicle Intelligence/i.test(value.text) && /Open Recompete Intelligence/i.test(value.text) && /127\.0\.0\.1:8791\/teaming/i.test(value.text) && /127\.0\.0\.1:8791\/opportunities/i.test(value.text) && /127\.0\.0\.1:8791\/vehicles/i.test(value.text) && /127\.0\.0\.1:8791\/recompetes/i.test(value.text) },
  { name: "CEO revenue", port: 8737, path: "/api/revenue", expect: value => value.json?.ok === true },
  { name: "CEO growth assets", port: 8737, path: "/api/growth-assets", expect: value => value.json?.ok === true },
  { name: "Desktop UI", port: 3737, path: "/api/status", expect: value => value.json?.runtime === "running" },
  { name: "Customer delivery", port: 8792, path: "/api/health", expect: value => value.json?.ok === true && value.json?.capabilities?.includes("lead_scoring") && value.json?.capabilities?.includes("client_onboarding") },
  { name: "Revenue Command Center", port: 8792, path: "/api/revenue", expect: value => value.json?.ok === true },
  { name: "Meeting pipeline", port: 8792, path: "/api/meetings", expect: value => value.json?.ok === true && value.json?.metrics && Array.isArray(value.json?.meetings) },
  { name: "Client success", port: 8792, path: "/api/client-success", expect: value => value.json?.ok === true && value.json?.metrics && Array.isArray(value.json?.clients) },
  { name: "P2GC prospect intelligence runtime", port: 8791, path: "/api/health", expect: value => value.json?.status === "HEALTHY" && ["executive_growth_blueprint","prime_sub_teaming","opportunity_intelligence","vehicle_intelligence","recompete_intelligence"].every(x=>value.json?.capabilities?.includes(x)) },
  { name: "Full Prospect Blueprint UI", port: 8791, path: "/", expect: value => /Executive Government Growth Blueprint/i.test(value.text) && /company name, UEI, CAGE, or website/i.test(value.text) && /Sub2Prime/i.test(value.text) },
  { name: "Sub2Prime teaming UI", port: 8791, path: "/teaming", expect: value => /Sub2Prime/i.test(value.text) && /Prime-Sub Teaming Intelligence/i.test(value.text) },
  { name: "Opportunity Intelligence UI", port: 8791, path: "/opportunities", expect: value => /Focused government contracting intelligence/i.test(value.text) && /opportunities/i.test(value.text) },
  { name: "Vehicle Intelligence UI", port: 8791, path: "/vehicles", expect: value => /Focused government contracting intelligence/i.test(value.text) && /vehicles/i.test(value.text) },
  { name: "Recompete Intelligence UI", port: 8791, path: "/recompetes", expect: value => /Focused government contracting intelligence/i.test(value.text) && /recompetes/i.test(value.text) }
];

function controlPlaneSourceContract() {
  try {
    const source = fs.readFileSync(COMMAND_CENTER_FILE, "utf8");
    const directLockedList = /taskQueue\.list\s*\(/.test(source);
    const workerSnapshot = /WORKER_RUNTIME_STATUS/.test(source);
    const lockFreeMarker = /lockFree\s*:\s*true/.test(source);
    return { ok:!directLockedList&&workerSnapshot&&lockFreeMarker, directLockedList, workerSnapshot, lockFreeMarker };
  } catch (error) { return {ok:false,error:error.message}; }
}

function request(port, pathname, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = http.request({hostname:"127.0.0.1",port,path:pathname,method:"GET",timeout:timeoutMs,headers:{Connection:"close",Accept:"application/json,text/plain,*/*"}}, res => {
      const chunks=[];
      res.on("data",chunk=>chunks.push(chunk));
      res.on("aborted",()=>reject(new Error(`response aborted after ${chunks.reduce((n,c)=>n+c.length,0)} bytes`)));
      res.on("error",reject);
      res.on("end",()=>{
        const text=Buffer.concat(chunks).toString("utf8");let json=null;try{json=JSON.parse(text||"{}");}catch{}
        resolve({statusCode:Number(res.statusCode||0),headers:res.headers,text,json,bytes:Buffer.byteLength(text),elapsedMs:Date.now()-startedAt});
      });
    });
    req.on("timeout",()=>req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error",reject);req.end();
  });
}

(async()=>{
  const results=[];
  const sourceContract=controlPlaneSourceContract();
  results.push({name:"Command Center lock-free source contract",ok:sourceContract.ok,...sourceContract});
  console.log(`[${sourceContract.ok?"PASS":"FAIL"}] Command Center lock-free source contract`);
  for(const check of checks){
    try{
      const response=await request(check.port,check.path);
      const withinBudget=!check.maxMs||response.elapsedMs<=check.maxMs;
      const ok=response.statusCode===200&&withinBudget&&check.expect(response);
      results.push({name:check.name,ok,statusCode:response.statusCode,bytes:response.bytes,elapsedMs:response.elapsedMs,maxMs:check.maxMs||null,headers:response.headers,taskQueueSource:response.json?.taskQueue?.source||null,taskQueueCacheHit:response.json?.taskQueue?.cacheHit??null});
      console.log(`[${ok?"PASS":"FAIL"}] ${check.name} http=${response.statusCode} bytes=${response.bytes} elapsed=${response.elapsedMs}ms${check.maxMs?` budget=${check.maxMs}ms`:""}`);
      if(!ok) console.log(response.text.slice(0,1000));
    }catch(error){results.push({name:check.name,ok:false,error:error.message});console.log(`[FAIL] ${check.name} :: ${error.message}`);}
  }
  const ok=results.every(item=>item.ok);
  console.log(`=== MILES CORE HTTP PROBE ${ok?"PASS":"FAIL"} ===`);
  if(!ok) console.log(JSON.stringify(results,null,2));
  process.exitCode=ok?0:1;
})().catch(error=>{console.error(error.stack||error.message);process.exit(1);});
