"use strict";

/**
 * MILES Dashboard Server Service
 * BUILD_037
 * Complete replacement file.
 *
 * Purpose:
 * Local read-only HTTP server for the Executive Dashboard.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const dashboard = require("./ExecutiveDashboardService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "executive_dashboard");
const HTML_FILE = path.join(OUT_DIR, "index.html");
const STATE_FILE = path.join(OUT_DIR, "dashboard_state.json");

class DashboardServerService {
    run(input = {}) {
        const port = Number(input.port || process.env.MILES_DASHBOARD_PORT || 8737);
        dashboard.run({ source: "DashboardServerService" });

        const server = http.createServer((req, res) => {
            try {
                if (req.url === "/api/state") {
                    dashboard.run({ source: "DashboardServerService/api" });
                    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                    res.end(fs.readFileSync(STATE_FILE, "utf8"));
                    return;
                }

                dashboard.run({ source: "DashboardServerService/html" });
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(fs.readFileSync(HTML_FILE, "utf8"));
            } catch (error) {
                res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
            }
        });

        server.listen(port, "127.0.0.1", () => {
            console.log(`MILES Executive Dashboard running at http://127.0.0.1:${port}`);
            console.log("Press Ctrl+C to stop.");
        });

        return {
            ok: true,
            action: "DASHBOARD_SERVER",
            generatedAt: new Date().toISOString(),
            port,
            url: `http://127.0.0.1:${port}`,
            outDir: OUT_DIR
        };
    }
}

module.exports = new DashboardServerService();
