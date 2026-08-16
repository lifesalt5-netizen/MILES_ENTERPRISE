"use strict";

/**
 * MILES CEO Dashboard Server
 * Dedicated CEO control surface: operating truth, revenue/customer truth,
 * executive brief, and governed command execution through the 8787 backend.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const dashboard = require("./ExecutiveDashboardService");
const ceoBrief = require("./CEORevenueBriefService");
const customerDelivery = require("./customer/P2GCCustomerDeliveryService");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "DATA", "executive_dashboard");
const LEGACY_HTML_FILE = path.join(OUT_DIR, "index.html");
const STATE_FILE = path.join(OUT_DIR, "dashboard_state.json");
const PUBLIC_DIR = path.join(ROOT, "SERVICES", "ceo_dashboard", "public");
const CONTROL_HTML = path.join(PUBLIC_DIR, "index.html");
const CONTROL_JS = path.join(PUBLIC_DIR, "ceo.js");
const CONTROL_CSS = path.join(PUBLIC_DIR, "ceo.css");

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(body);
}
function sendJson(res, status, body) { send(res, status, "application/json; charset=utf-8", JSON.stringify(body, null, 2)); }
function sendFile(res, file, type) { send(res, 200, type, fs.readFileSync(file)); }
function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on("data", chunk => { total += chunk.length; if (total > maxBytes) { reject(new Error("Request body too large.")); req.destroy(); return; } chunks.push(chunk); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
  });
}
function proxyMilesCommand(payload) {
  const host = process.env.MILES_COMMAND_CENTER_HOST || "127.0.0.1";
  const port = Number(process.env.MILES_COMMAND_CENTER_PORT || 8787);
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: host, port, path: "/api/command", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length }, timeout: 120000 }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8"); let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ statusCode: response.statusCode || 500, body: json || { ok:false, raw:text } });
      });
    });
    request.on("timeout", () => request.destroy(new Error("MILES Command Center request timed out."))); request.on("error", reject); request.end(body);
  });
}

class DashboardServerService {
  run(input = {}) {
    const port = Number(input.port || process.env.MILES_DASHBOARD_PORT || 8737);
    dashboard.run({ source: "DashboardServerService" }); ceoBrief.build();

    const server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
        if (req.method === "GET" && requestUrl.pathname === "/api/state") {
          dashboard.run({ source: "DashboardServerService/api/state" }); send(res, 200, "application/json; charset=utf-8", fs.readFileSync(STATE_FILE, "utf8")); return;
        }
        if (req.method === "GET" && requestUrl.pathname === "/api/brief") {
          const clientId = requestUrl.searchParams.get("clientId");
          if (clientId) { sendJson(res, 200, customerDelivery.executiveBrief(clientId)); return; }
          const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8").replace(/^\uFEFF/, "")); sendJson(res, 200, ceoBrief.build({ state })); return;
        }
        if (req.method === "GET" && requestUrl.pathname === "/api/revenue") { sendJson(res, 200, customerDelivery.revenueCommandCenter()); return; }
        if (req.method === "GET" && requestUrl.pathname === "/api/customer-health") { sendJson(res, 200, customerDelivery.healthCheck()); return; }
        if (req.method === "GET" && requestUrl.pathname === "/api/clients") { sendJson(res, 200, customerDelivery.list("clients")); return; }
        if (req.method === "GET" && requestUrl.pathname === "/api/prospects") { sendJson(res, 200, customerDelivery.list("prospects")); return; }
        if (req.method === "GET" && requestUrl.pathname === "/api/client") { sendJson(res, 200, customerDelivery.portal(requestUrl.searchParams.get("clientId"))); return; }

        if (req.method === "POST" && requestUrl.pathname === "/api/command") {
          const raw = await readBody(req); let payload; try { payload = JSON.parse(raw || "{}"); } catch { sendJson(res, 400, { ok:false, error:"Invalid JSON body." }); return; }
          const command = String(payload.command || "").trim(); if (!command) { sendJson(res, 400, { ok:false, error:"command is required" }); return; }
          const result = await proxyMilesCommand({ command }); sendJson(res, result.statusCode, result.body); return;
        }

        if (req.method === "POST" && ["/api/prospect","/api/client","/api/subscription","/api/invoice","/api/referral"].includes(requestUrl.pathname)) {
          const raw = await readBody(req); let payload; try { payload = JSON.parse(raw || "{}"); } catch { sendJson(res,400,{ok:false,error:"Invalid JSON body."}); return; }
          const handlers = {
            "/api/prospect": () => customerDelivery.upsertProspect(payload),
            "/api/client": () => customerDelivery.upsertClient(payload),
            "/api/subscription": () => customerDelivery.upsertSubscription(payload),
            "/api/invoice": () => customerDelivery.createInvoice(payload),
            "/api/referral": () => customerDelivery.addReferral(payload)
          };
          sendJson(res, 200, handlers[requestUrl.pathname]()); return;
        }

        if (req.method === "GET" && requestUrl.pathname === "/ceo.js") { sendFile(res, CONTROL_JS, "application/javascript; charset=utf-8"); return; }
        if (req.method === "GET" && requestUrl.pathname === "/ceo.css") { sendFile(res, CONTROL_CSS, "text/css; charset=utf-8"); return; }
        if (req.method === "GET" && requestUrl.pathname === "/legacy") { dashboard.run({ source: "DashboardServerService/legacy" }); sendFile(res, LEGACY_HTML_FILE, "text/html; charset=utf-8"); return; }
        if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) { sendFile(res, CONTROL_HTML, "text/html; charset=utf-8"); return; }
        sendJson(res, 404, { ok:false, error:"Not found" });
      } catch (error) { sendJson(res, 500, { ok:false, error:error.message }); }
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`MILES CEO Dashboard running at http://127.0.0.1:${port}`);
      console.log(`MILES execution backend remains separate at http://127.0.0.1:${Number(process.env.MILES_COMMAND_CENTER_PORT || 8787)}`);
      console.log("P2GC revenue/customer delivery truth is available on /api/revenue, /api/prospects, /api/clients, and /api/client.");
    });

    return { ok:true, action:"CEO_DASHBOARD_SERVER", generatedAt:new Date().toISOString(), port, url:`http://127.0.0.1:${port}`, executionBackend:`http://127.0.0.1:${Number(process.env.MILES_COMMAND_CENTER_PORT || 8787)}`, outDir:OUT_DIR };
  }
}

module.exports = new DashboardServerService();
