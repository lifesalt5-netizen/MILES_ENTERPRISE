"use strict";

const http = require("http");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function requestOnce({ host = "127.0.0.1", port, path = "/", requestTimeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = http.request({
      hostname: host,
      port: Number(port),
      path,
      method: "GET",
      timeout: Math.max(250, Number(requestTimeoutMs) || 5000),
      headers: {
        Connection: "close",
        Accept: "application/json,text/plain,text/html,*/*"
      }
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("aborted", () => reject(new Error(`response aborted after ${chunks.reduce((n, c) => n + c.length, 0)} bytes`)));
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
          bytes: Buffer.byteLength(text),
          elapsedMs: Date.now() - startedAt
        });
      });
    });
    req.on("timeout", () => {
      const error = new Error(`timeout after ${Math.max(250, Number(requestTimeoutMs) || 5000)}ms`);
      error.code = "ETIMEDOUT";
      req.destroy(error);
    });
    req.on("error", reject);
    req.end();
  });
}

function isTransientStartupError(error) {
  const code = String(error?.code || "").toUpperCase();
  return ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH"].includes(code);
}

async function waitForHttpReady({
  host = "127.0.0.1",
  port,
  path = "/",
  timeoutMs = 30000,
  intervalMs = 250,
  requestTimeoutMs = 3000,
  acceptStatus = status => Number(status) === 200,
  requestFn = requestOnce
} = {}) {
  if (!Number(port)) throw new Error("HTTP readiness requires a numeric port.");
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1, Number(timeoutMs) || 30000);
  let attempts = 0;
  let lastError = null;
  let lastResponse = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const response = await requestFn({ host, port:Number(port), path, requestTimeoutMs });
      lastResponse = response;
      if (acceptStatus(response.statusCode, response)) {
        return {
          ok: true,
          host,
          port:Number(port),
          path,
          attempts,
          startupElapsedMs: Date.now() - startedAt,
          response
        };
      }
      lastError = new Error(`HTTP ${response.statusCode} while waiting for readiness.`);
    } catch (error) {
      lastError = error;
      if (!isTransientStartupError(error)) throw error;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(Math.max(10, Number(intervalMs) || 250), remaining));
  }

  const detail = lastResponse
    ? `lastHttp=${lastResponse.statusCode}`
    : `lastError=${lastError?.code || lastError?.message || "unknown"}`;
  const error = new Error(`HTTP surface did not become ready within ${Math.max(1, Number(timeoutMs) || 30000)}ms: http://${host}:${Number(port)}${path} (${detail}, attempts=${attempts})`);
  error.code = "HTTP_READINESS_TIMEOUT";
  error.attempts = attempts;
  error.lastError = lastError || null;
  error.lastResponse = lastResponse || null;
  throw error;
}

if (require.main === module) {
  const port = Number(process.argv[2]);
  const path = process.argv[3] || "/";
  const timeoutMs = Number(process.argv[4] || 30000);
  waitForHttpReady({ port, path, timeoutMs })
    .then(result => {
      console.log(`[HTTP READY] http://127.0.0.1:${port}${path} status=${result.response.statusCode} attempts=${result.attempts} startup=${result.startupElapsedMs}ms`);
    })
    .catch(error => {
      console.error(`[HTTP NOT READY] ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  requestOnce,
  isTransientStartupError,
  waitForHttpReady
};
