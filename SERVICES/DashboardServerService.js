"use strict";

/**
 * MILES CEO Dashboard Server
 *
 * Purpose:
 * Dedicated internal CEO control surface.
 * - Read-only operating truth comes from ExecutiveDashboardService/DashboardDataService.
 * - Daily $10K/week brief comes from CEORevenueBriefService.
 * - Commands are proxied to the live MILES 8787 Command Center.
 * - This service does not execute business work itself.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const dashboard = require("./ExecutiveDashboardService");
const ceoBrief = require("./CEORevenueBriefService");

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
function sendFile(res, file, type) {
  send(res, 200, type, fs.readFileSync(file));
}
function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function proxyMilesCommand(payload) {
  const host = process.env.MILES_COMMAND_CENTER_HOST || "127.0.0.1";
  const port = Number(process.env.MILES_COMMAND_CENTER_PORT || 8787);
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: host,
      port,
      path: "/api/command",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": body.length
      },
      timeout: 120000
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ statusCode: response.statusCode || 500, body: json || { ok:false, raw:text } });
      });
    });
    request.on("timeout", () => request.destroy(new Error("MILES Command Center request timed out.")));
    request.on("error", reject);
    request.end(body);
  });
}

class DashboardServerService {
  run(input = {}) {
    const port = Number(input.port || process.env.MILES_DASHBOARD_PORT || 8737);
    dashboard.run({ source: "DashboardServerService" });
    ceoBrief.build();

    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.url === "/api/state") {
          dashboard.run({ source: "DashboardServerService/api/state" });
          send(res, 200, "application/json; charset=utf-8", fs.readFileSync(STATE_FILE, "utf8"));
          return;
        }

        if (req.method === "GET" && req.url === "/api/brief") {
          const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8").replace(/^\uFEFF/, ""));
          const brief = ceoBrief.build({ state });
          send(res, 200, "application/json; charset=utf-8", JSON.stringify(brief, null, 2));
          return;
        }

        if (req.method === "POST" && req.url === "/api/command") {
          const raw = await readBody(req);
          let payload;
          try { payload = JSON.parse(raw || "{}"); }
          catch { send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok:false, error:"Invalid JSON body." }, null, 2)); return; }
          const command = String(payload.command || "").trim();
          if (!command) {
            send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok:false, error:"command is required" }, null, 2));
            return;
          }
          const result = await proxyMilesCommand({ command });
          send(res, result.statusCode, "application/json; charset=utf-8", JSON.stringify(result.body, null, 2));
          return;
        }

        if (req.method === "GET" && req.url === "/ceo.js") { sendFile(res, CONTROL_JS, "application/javascript; charset=utf-8"); return; }
        if (req.method === "GET" && req.url === "/ceo.css") { sendFile(res, CONTROL_CSS, "text/css; charset=utf-8"); return; }
        if (req.method === "GET" && req.url === "/legacy") {
          dashboard.run({ source: "DashboardServerService/legacy" });
          sendFile(res, LEGACY_HTML_FILE, "text/html; charset=utf-8");
          return;
        }

        if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
          sendFile(res, CONTROL_HTML, "text/html; charset=utf-8");
          return;
        }

        send(res, 404, "application/json; charset=utf-8", JSON.stringify({ ok:false, error:"Not found" }, null, 2));
      } catch (error) {
        send(res, 500, "application/json; charset=utf-8", JSON.stringify({ ok:false, error:error.message }, null, 2));
      }
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(`MILES CEO Dashboard running at http://127.0.0.1:${port}`);
      console.log(`MILES execution backend remains separate at http://127.0.0.1:${Number(process.env.MILES_COMMAND_CENTER_PORT || 8787)}`);
    });

    return {
      ok: true,
      action: "CEO_DASHBOARD_SERVER",
      generatedAt: new Date().toISOString(),
      port,
      url: `http://127.0.0.1:${port}`,
      executionBackend: `http://127.0.0.1:${Number(process.env.MILES_COMMAND_CENTER_PORT || 8787)}`,
      outDir: OUT_DIR
    };
  }
}

module.exports = new DashboardServerService();
