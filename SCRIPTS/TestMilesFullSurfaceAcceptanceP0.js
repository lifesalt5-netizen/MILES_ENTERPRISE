"use strict";

const http = require("http");

const checks = [];
function add(name, ok, detail="") {
  checks.push({ name, ok:Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + detail : ""}`);
}
function request(port, path="/", method="GET", body=null, timeoutMs=15000) {
  return new Promise((resolve,reject)=>{
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname:"127.0.0.1", port, path, method, timeout:timeoutMs,
      headers: payload ? {"Content-Type":"application/json","Content-Length":payload.length} : {}
    }, res=>{
      const chunks=[];
      res.on("data", c=>chunks.push(c));
      res.on("end", ()=>{
        const text=Buffer.concat(chunks).toString("utf8");
        let json=null; try { json=JSON.parse(text); } catch {}
        resolve({status:res.statusCode||0,text,json});
      });
    });
    req.on("timeout",()=>req.destroy(new Error(`timeout ${port}${path}`)));
    req.on("error",reject);
    if(payload) req.write(payload);
    req.end();
  });
}
async function probe(name, port, path, predicate) {
  try {
    const r=await request(port,path);
    add(name, predicate(r), `http=${r.status}`);
    return r;
  } catch(e) { add(name,false,e.message); return null; }
}

(async()=>{
  await probe("MILES API port 3000",3000,"/",r=>r.status===200 && /MILES OS is running/i.test(r.text));
  await probe("MILES Desktop port 3737",3737,"/api/status",r=>r.status===200 && r.json?.runtime==="running");
  await probe("MILES Command Center health 8787",8787,"/api/health",r=>r.status===200 && r.json?.ok===true);
  await probe("MILES Command Center dashboard 8787",8787,"/api/dashboard",r=>r.status===200 && r.json?.ok===true);
  await probe("CEO Dashboard state 8737",8737,"/api/state",r=>r.status===200 && r.json && typeof r.json==="object");
  await probe("P2GC Growth Demo health 8791",8791,"/api/health",r=>r.status===200 && /HEALTHY/i.test(JSON.stringify(r.json||r.text)));

  try {
    const command = await request(
      8737, "/api/command", "POST",
      {command:"Review the current P2GC revenue pipeline and report the top 3 actions that should be taken next. Read-only acceptance test. Do not send email, modify campaigns, or change external systems."},
      70000
    );
    const accepted = command.status===200 && command.json?.ok===true;
    add("CEO Dashboard command reaches MILES", accepted, `http=${command.status} status=${command.json?.status||""}`);
  } catch(e) {
    add("CEO Dashboard command reaches MILES", false, e.message);
  }

  const result={ok:checks.every(x=>x.ok),generatedAt:new Date().toISOString(),checks};
  console.log(`=== FULL SURFACE ACCEPTANCE ${result.ok ? "PASS" : "FAIL"} ===`);
  if(!result.ok) process.exitCode=1;
})().catch(e=>{console.error(e.stack||e.message);process.exit(1);});
