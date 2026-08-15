"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "digital_coo", "MilesCommandCenter.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_PROSPECT_DEMO_TRUTH_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("ProspectDemoTruthService")) {
  const anchors = [
    "const DemoTruthReportService = require('./DemoTruthReportService');",
    "const CEOIntentEngineService = require('../CEOIntentEngineService');"
  ];
  const anchor = anchors.find(x => text.includes(x));
  if (!anchor) throw new Error("Could not locate Command Center require anchor for ProspectDemoTruthService.");
  text = text.replace(anchor, `${anchor}\nconst ProspectDemoTruthService = require('./ProspectDemoTruthService');`);
}

if (!text.includes("const prospectDemoTruth = new ProspectDemoTruthService")) {
  const anchors = [
    "const demoTruthReport = new DemoTruthReportService({ rootDir: ROOT, departmentDashboard });",
    "const executiveResponses = new ExecutiveResponseService({\n  rootDir: ROOT\n});"
  ];
  const anchor = anchors.find(x => text.includes(x));
  if (!anchor) throw new Error("Could not locate Command Center service-instance anchor for ProspectDemoTruthService.");
  text = text.replace(anchor, `${anchor}\n\nconst prospectDemoTruth = new ProspectDemoTruthService({ rootDir: ROOT });`);
}

if (!text.includes("MILES_PROSPECT_DEMO_TRUTH_P0")) {
  const legacyDemo = "    if (req.method === 'GET' && req.url === '/api/demo') {";
  const health = "    if (req.method === 'GET' && req.url === '/api/health') {";
  let idx = text.indexOf(legacyDemo);
  if (idx < 0) idx = text.indexOf(health);
  if (idx < 0) throw new Error("Could not locate demo/health route insertion anchor.");

  const route = `    // MILES_PROSPECT_DEMO_TRUTH_P0\n    if (req.method === 'GET' && req.url === '/demo') {\n      const file = path.join(__dirname, 'public', 'demo.html');\n      sendStaticFile(res, file, 'text/html; charset=utf-8');\n      return;\n    }\n\n    if (req.method === 'GET' && req.url === '/demo.js') {\n      const file = path.join(__dirname, 'public', 'demo.js');\n      sendStaticFile(res, file, 'application/javascript; charset=utf-8');\n      return;\n    }\n\n    if (req.method === 'GET' && req.url === '/demo.css') {\n      const file = path.join(__dirname, 'public', 'demo.css');\n      sendStaticFile(res, file, 'text/css; charset=utf-8');\n      return;\n    }\n\n    if (req.method === 'GET' && req.url.startsWith('/api/demo/export')) {\n      try {\n        const url = new URL(req.url, \\`http://localhost:\\${PORT}\\`);\n        const term = String(url.searchParams.get('company') || url.searchParams.get('uei') || '').trim();\n        const format = String(url.searchParams.get('format') || 'json').toLowerCase();\n        if (!term) {\n          res.writeHead(400, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });\n          res.end(JSON.stringify({ ok:false, status:'TERM_REQUIRED', message:'company or UEI is required' }, null, 2));\n          return;\n        }\n        const truth = await prospectDemoTruth.build(term);\n        if (!truth.ok) {\n          res.writeHead(404, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });\n          res.end(JSON.stringify(truth, null, 2));\n          return;\n        }\n        const safe = String(truth.identity?.name || truth.identity?.uei || 'prospect').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0,80);\n        let body; let type; let ext;\n        if (format === 'md' || format === 'markdown') { body = prospectDemoTruth.renderMarkdown(truth); type = 'text/markdown; charset=utf-8'; ext = 'md'; }\n        else if (format === 'html') { body = prospectDemoTruth.renderHtml(truth); type = 'text/html; charset=utf-8'; ext = 'html'; }\n        else { body = JSON.stringify(truth, null, 2); type = 'application/json; charset=utf-8'; ext = 'json'; }\n        res.writeHead(200, { 'Content-Type':type, 'Cache-Control':'no-store', 'Content-Disposition':\\`attachment; filename=\\"MILES_Prospect_Demo_\\${safe}.\\${ext}\\"\\` });\n        res.end(body);\n      } catch (error) {\n        res.writeHead(500, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });\n        res.end(JSON.stringify({ ok:false, status:'DEMO_EXPORT_FAILED', error:error.message }, null, 2));\n      }\n      return;\n    }\n\n    if (req.method === 'GET' && req.url.startsWith('/api/demo')) {\n      try {\n        const url = new URL(req.url, \\`http://localhost:\\${PORT}\\`);\n        const term = String(url.searchParams.get('company') || url.searchParams.get('uei') || '').trim();\n        if (!term) {\n          res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });\n          res.end(JSON.stringify({ ok:true, status:'DEMO_READY_FOR_PROSPECT', readOnly:true, required:'company name or UEI', page:'/demo' }, null, 2));\n          return;\n        }\n        const truth = await prospectDemoTruth.build(term);\n        res.writeHead(truth.ok ? 200 : 404, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });\n        res.end(JSON.stringify(truth, null, 2));\n      } catch (error) {\n        res.writeHead(500, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });\n        res.end(JSON.stringify({ ok:false, status:'PROSPECT_DEMO_FAILED', error:error.message }, null, 2));\n      }\n      return;\n    }\n\n`;

  text = text.slice(0, idx) + route + text.slice(idx);
}

if (text === original) {
  console.log("[SKIP] 8787 prospect demo truth already installed.");
  process.exit(0);
}

fs.writeFileSync(file, text, "utf8");
console.log("=== 8787 PROSPECT DEMO TRUTH P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("routes : /demo, /api/demo?company=, /api/demo/export");
console.log("next   : node --check .\\SERVICES\\digital_coo\\MilesCommandCenter.js");
