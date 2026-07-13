"use strict";

const https = require("https");
const http = require("http");

const DEFAULT_URL =
  process.env.P2GC_WEBSITE_URL ||
  "https://pathways2gc.com";

function now() {
  return new Date().toISOString();
}

function fetchUrl(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = url.startsWith("https") ? https : http;

    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk.toString();
      });

      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode,
          body,
          loadMs: Date.now() - start,
          url
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        statusCode: 0,
        body: "",
        loadMs: Date.now() - start,
        error: "timeout",
        url
      });
    });

    req.on("error", (err) => {
      resolve({
        ok: false,
        statusCode: 0,
        body: "",
        loadMs: Date.now() - start,
        error: err.message,
        url
      });
    });
  });
}

function extractTag(html, tag) {
  const match = String(html || "").match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function extractMetaDescription(html) {
  const match = String(html || "").match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  );
  return match ? match[1].trim() : "";
}

function contains(html, list = []) {
  const text = String(html || "").toLowerCase();
  return list.some((t) => text.includes(String(t).toLowerCase()));
}

/**
 * PURE CONNECTOR
 * NO CLASSES
 * NO PROVIDER DEPENDENCIES
 * NO IDataProvider
 */
async function auditWebsite(url = DEFAULT_URL) {
  const res = await fetchUrl(url);
  const html = res.body || "";

  return {
    ok: res.ok,
    url,
    checkedAt: now(),
    metrics: {
      homepageReachable: res.ok,
      statusCode: res.statusCode,
      loadMs: res.loadMs,

      title: extractTag(html, "title"),
      h1: extractTag(html, "h1"),
      metaDescription: extractMetaDescription(html),

      https: url.startsWith("https://"),

      hasCTA: contains(html, ["schedule", "book", "call"]),
      hasContact: contains(html, ["contact", "email"]),
      hasCalendly: contains(html, ["calendly"]),
      hasServices: contains(html, ["services", "govcon"]),
      hasPhone: contains(html, ["813"]),
      hasEmail: contains(html, ["@"])
    }
  };
}

module.exports = {
  auditWebsite,
  fetchUrl
};