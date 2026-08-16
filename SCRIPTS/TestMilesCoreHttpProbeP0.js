"use strict";

const http = require("http");

const checks = [
  { name: "MILES API", port: 3000, path: "/", expect: value => /MILES OS is running/i.test(value.text) },
  { name: "Command Center health", port: 8787, path: "/api/health", expect: value => value.json?.ok === true },
  { name: "Command Center dashboard", port: 8787, path: "/api/dashboard", expect: value => value.json?.ok === true },
  { name: "CEO Dashboard state", port: 8737, path: "/api/state", expect: value => Boolean(value.json) },
  { name: "CEO revenue", port: 8737, path: "/api/revenue", expect: value => value.json?.ok === true },
  { name: "CEO growth assets", port: 8737, path: "/api/growth-assets", expect: value => value.json?.ok === true },
  { name: "Desktop UI", port: 3737, path: "/api/status", expect: value => value.json?.runtime === "running" },
  { name: "Customer delivery", port: 8792, path: "/api/health", expect: value => value.json?.ok === true },
  { name: "Revenue Command Center", port: 8792, path: "/api/revenue", expect: value => value.json?.ok === true }
];

function request(port, pathname, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      timeout: timeoutMs,
      headers: { Connection: "close", Accept: "application/json,text/plain,*/*" }
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("aborted", () => reject(new Error(`response aborted after ${chunks.reduce((n,c)=>n+c.length,0)} bytes`)));
      res.on("error", reject);
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text || "{}"); } catch {}
        resolve({
          statusCode: Number(res.statusCode || 0),
          headers: res.headers,
          text,
          json,
          bytes: Buffer.byteLength(text)
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const results = [];
  for (const check of checks) {
    try {
      const response = await request(check.port, check.path);
      const ok = response.statusCode === 200 && check.expect(response);
      results.push({ name:check.name, ok, statusCode:response.statusCode, bytes:response.bytes, headers:response.headers });
      console.log(`[${ok ? "PASS" : "FAIL"}] ${check.name} http=${response.statusCode} bytes=${response.bytes}`);
      if (!ok) {
        console.log(response.text.slice(0, 1000));
      }
    } catch (error) {
      results.push({ name:check.name, ok:false, error:error.message });
      console.log(`[FAIL] ${check.name} :: ${error.message}`);
    }
  }
  const ok = results.every(item => item.ok);
  console.log(`=== MILES CORE HTTP PROBE ${ok ? "PASS" : "FAIL"} ===`);
  if (!ok) console.log(JSON.stringify(results, null, 2));
  process.exitCode = ok ? 0 : 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
