"use strict";

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, "public");
const PORT = Number(process.env.MILES_EXECUTIVE_SHELL_PORT || 8790);

const services = {
  commandCenter: process.env.MILES_COMMAND_CENTER_URL || "http://127.0.0.1:8787",
  desktop: process.env.MILES_DESKTOP_URL || "http://127.0.0.1:3737",
  dashboard: process.env.MILES_EXECUTIVE_DASHBOARD_URL || "http://127.0.0.1:8737",
  api: process.env.MILES_API_URL || "http://127.0.0.1:3000",
  orionDemo: process.env.MILES_ORION_DEMO_URL || "",
  sub2Prime: process.env.MILES_SUB2PRIME_URL || "",
  proposalStudio: process.env.MILES_PROPOSAL_STUDIO_URL || ""
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;

      if (body.length > 5_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function proxyRequest(req, res, targetBase, targetPath) {
  const target = new URL(targetPath, targetBase);

  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host
    }
  };

  const proxy = http.request(options, proxyRes => {
    const headers = {
      ...proxyRes.headers,
      "cache-control": "no-store"
    };

    res.writeHead(proxyRes.statusCode || 502, headers);
    proxyRes.pipe(res);
  });

  proxy.on("error", error => {
    sendJson(res, 502, {
      ok: false,
      error: "UPSTREAM_UNAVAILABLE",
      message: error.message,
      upstream: targetBase
    });
  });

  req.pipe(proxy);
}

async function checkService(name, url) {
  if (!url) {
    return {
      name,
      configured: false,
      healthy: false,
      url: null
    };
  }

  return new Promise(resolve => {
    const request = http.get(url, response => {
      response.resume();

      resolve({
        name,
        configured: true,
        healthy: response.statusCode >= 200 && response.statusCode < 500,
        statusCode: response.statusCode,
        url
      });
    });

    request.setTimeout(3000, () => {
      request.destroy(new Error("Health check timed out."));
    });

    request.on("error", error => {
      resolve({
        name,
        configured: true,
        healthy: false,
        error: error.message,
        url
      });
    });
  });
}

async function handleHealth(req, res) {
  const checks = await Promise.all([
    checkService("Command Center", services.commandCenter),
    checkService("Desktop UI", services.desktop),
    checkService("Executive Dashboard", services.dashboard),
    checkService("MILES API", services.api),
    checkService("ORION Demo", services.orionDemo),
    checkService("Sub2Prime", services.sub2Prime),
    checkService("Proposal Studio", services.proposalStudio)
  ]);

  sendJson(res, 200, {
    ok: true,
    service: "MILES_EXECUTIVE_SHELL",
    generatedAt: new Date().toISOString(),
    checks
  });
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const normalized = path
    .normalize(pathname)
    .replace(/^(\.\.[/\\])+/, "");

  const filePath = path.join(PUBLIC_ROOT, normalized);

  if (!filePath.startsWith(PUBLIC_ROOT)) {
    sendJson(res, 403, {
      ok: false,
      error: "FORBIDDEN"
    });
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(res, 404, {
        ok: false,
        error: "NOT_FOUND",
        path: pathname
      });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/shell/config") {
      sendJson(res, 200, {
        ok: true,
        services
      });
      return;
    }

    if (requestUrl.pathname === "/api/shell/health") {
      await handleHealth(req, res);
      return;
    }

    if (requestUrl.pathname === "/api/desktop/status") {
      proxyRequest(req, res, services.desktop, "/api/status");
      return;
    }

    if (requestUrl.pathname === "/api/command") {
      proxyRequest(req, res, services.commandCenter, "/api/command");
      return;
    }

    if (requestUrl.pathname === "/api/operation") {
      proxyRequest(
        req,
        res,
        services.commandCenter,
        requestUrl.pathname + requestUrl.search
      );
      return;
    }

    if (requestUrl.pathname.startsWith("/api/operations/")) {
      proxyRequest(
        req,
        res,
        services.commandCenter,
        requestUrl.pathname + requestUrl.search
      );
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "EXECUTIVE_SHELL_ERROR",
      message: error.message
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[MILES EXECUTIVE SHELL] Running: http://127.0.0.1:${PORT}`
  );
  console.log(
    "[MILES EXECUTIVE SHELL] Command Center proxy:",
    services.commandCenter
  );
});

function shutdown(signal) {
  console.log(`[MILES EXECUTIVE SHELL] Shutdown requested: ${signal}`);

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
