"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "digital_coo", "MilesCommandCenter.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_8787_DEMO_TRUTH_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("DemoTruthReportService")) {
  const anchor = "const DepartmentDashboardService = require('./DepartmentDashboardService');";
  if (!text.includes(anchor)) throw new Error("Could not locate DepartmentDashboardService require.");
  text = text.replace(anchor, `${anchor}\nconst DemoTruthReportService = require('./DemoTruthReportService');`);
}

if (!text.includes("const demoTruthReport = new DemoTruthReportService")) {
  const anchor = "const departmentDashboard = new DepartmentDashboardService({ rootDir: ROOT });";
  if (!text.includes(anchor)) throw new Error("Could not locate departmentDashboard instance.");
  text = text.replace(anchor, `${anchor}\nconst demoTruthReport = new DemoTruthReportService({ rootDir: ROOT, departmentDashboard });`);
}

if (!text.includes("req.url === '/api/demo'")) {
  const anchor = "    if (req.method === 'GET' && req.url === '/api/health') {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate /api/health route anchor.");
  const route = `    if (req.method === 'GET' && req.url === '/api/demo') {\n      try {\n        const truth = await demoTruthReport.snapshot();\n        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n        res.end(JSON.stringify(truth, null, 2));\n      } catch (error) {\n        res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });\n        res.end(JSON.stringify({ ok:false, status:'DEMO_TRUTH_FAILED', error:error.message }, null, 2));\n      }\n      return;\n    }\n\n    if (req.method === 'GET' && req.url === '/demo') {\n      try {\n        const truth = await demoTruthReport.snapshot();\n        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });\n        res.end(demoTruthReport.renderHtml(truth));\n      } catch (error) {\n        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });\n        res.end('Demo truth failed: ' + error.message);\n      }\n      return;\n    }\n\n`;
  text = text.slice(0, idx) + route + text.slice(idx);
}

if (text === original) throw new Error("No changes applied.");
fs.writeFileSync(file, text, "utf8");
console.log("=== 8787 DEMO TRUTH ROUTES P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("routes : /demo and /api/demo");
console.log("next   : node --check .\\SERVICES\\digital_coo\\MilesCommandCenter.js");
