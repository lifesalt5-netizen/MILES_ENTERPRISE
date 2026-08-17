"use strict";

const assert = require("assert");
const { isTransientStartupError, waitForHttpReady } = require("../SCRIPTS/WaitForHttpReady");

(async () => {
  assert.strictEqual(isTransientStartupError({ code:"ECONNREFUSED" }), true, "ECONNREFUSED must be retryable during startup");
  assert.strictEqual(isTransientStartupError({ code:"ECONNRESET" }), true, "ECONNRESET must be retryable during startup");
  assert.strictEqual(isTransientStartupError({ code:"ENOENT" }), false, "arbitrary errors must not be hidden by readiness retry");

  let attempts = 0;
  const transientThenReady = async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("connection refused");
      error.code = "ECONNREFUSED";
      throw error;
    }
    return { statusCode:200, text:"ready", json:null, bytes:5, elapsedMs:1, headers:{} };
  };

  const recovered = await waitForHttpReady({
    port:8737,
    path:"/api/state",
    timeoutMs:500,
    intervalMs:5,
    requestFn:transientThenReady
  });
  assert.strictEqual(recovered.ok, true, "readiness must recover from bounded startup refusal");
  assert.strictEqual(recovered.attempts, 3, "readiness must report actual attempts");
  assert.strictEqual(recovered.response.statusCode, 200, "readiness must require accepted HTTP status");

  let semanticAttempts = 0;
  const warmingThenReady = async () => {
    semanticAttempts += 1;
    if (semanticAttempts < 2) return { statusCode:503, text:"warming", json:null, bytes:7, elapsedMs:1, headers:{} };
    return { statusCode:200, text:"ready", json:null, bytes:5, elapsedMs:1, headers:{} };
  };
  const warmed = await waitForHttpReady({
    port:8737,
    path:"/api/state",
    timeoutMs:500,
    intervalMs:5,
    requestFn:warmingThenReady
  });
  assert.strictEqual(warmed.attempts, 2, "readiness may wait through an explicit non-ready HTTP status");

  let fatalThrown = false;
  try {
    await waitForHttpReady({
      port:8737,
      path:"/api/state",
      timeoutMs:100,
      intervalMs:5,
      requestFn:async () => {
        const error = new Error("bad local configuration");
        error.code = "ENOENT";
        throw error;
      }
    });
  } catch (error) {
    fatalThrown = error.code === "ENOENT";
  }
  assert.strictEqual(fatalThrown, true, "non-transient errors must fail immediately");

  let timeoutThrown = false;
  try {
    await waitForHttpReady({
      port:8737,
      path:"/api/state",
      timeoutMs:35,
      intervalMs:5,
      requestFn:async () => {
        const error = new Error("connection refused");
        error.code = "ECONNREFUSED";
        throw error;
      }
    });
  } catch (error) {
    timeoutThrown = error.code === "HTTP_READINESS_TIMEOUT" && Number(error.attempts) >= 2;
  }
  assert.strictEqual(timeoutThrown, true, "permanent refusal must fail after bounded timeout");

  console.log("[PASS] HTTP surface readiness retries transient startup failures and remains bounded");
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
