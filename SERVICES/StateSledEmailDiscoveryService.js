"use strict";

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_email_discovery_rules.json");

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!rows.length) {
    fs.writeFileSync(file, "", "utf8");
    return;
  }
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(headers.map(h => csvEscape(row[h])).join(","));
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(file)
      .pipe(csv())
      .on("data", row => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function first(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeDomain(value) {
  let s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  try {
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    return new URL(s).hostname.replace(/^www\./, "");
  } catch {
    return s.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}

function baseUrlFromRow(row) {
  const raw = first(row, ["website", "Website", "NORMALIZED_WEBSITE", "domain", "Domain"]);
  if (!raw) return "";
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function extractEmails(text) {
  if (!text) return [];
  const decoded = String(text)
    .replace(/&#64;|\[at\]|\(at\)/gi, "@")
    .replace(/&#46;|\[dot\]|\(dot\)/gi, ".");
  const matches = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map(x => x.toLowerCase().replace(/[),.;:]+$/, "")))];
}

function chooseEmail(emails, targetDomain, rules) {
  const excluded = new Set(rules.discovery.excludeLocalParts || []);
  const preferred = rules.discovery.preferredLocalParts || [];
  const valid = emails.filter(email => {
    const [local, domain] = email.split("@");
    if (!local || !domain) return false;
    if (excluded.has(local.toLowerCase())) return false;
    if (targetDomain && normalizeDomain(domain) !== normalizeDomain(targetDomain)) return false;
    return true;
  });
  valid.sort((a, b) => {
    const ai = preferred.indexOf(a.split("@")[0]);
    const bi = preferred.indexOf(b.split("@")[0]);
    const as = ai < 0 ? 999 : ai;
    const bs = bi < 0 ? 999 : bi;
    return as - bs || a.localeCompare(b);
  });
  return valid[0] || "";
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "MILES-P2GC/1.0 public-contact-discovery" }
    });
    if (!response.ok) return { ok: false, status: response.status, text: "", finalUrl: response.url || url };
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|text\/plain/i.test(type)) return { ok: false, status: response.status, text: "", finalUrl: response.url || url };
    const text = await response.text();
    return { ok: true, status: response.status, text: text.slice(0, 1500000), finalUrl: response.url || url };
  } catch (error) {
    return { ok: false, status: 0, text: "", finalUrl: url, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function getApiKey(rules) {
  for (const name of rules.verification.apiKeyEnvNames || []) {
    if (process.env[name]) return { name, value: process.env[name] };
  }
  return null;
}

async function verifyEmail(email, rules, apiKey) {
  if (!apiKey) return { provider: "MillionVerifier", status: "NOT_RUN", reason: "API_KEY_MISSING" };
  const url = new URL(rules.verification.apiBaseUrl);
  url.searchParams.set("api", apiKey.value);
  url.searchParams.set("email", email);
  url.searchParams.set("timeout", String(rules.verification.timeoutSeconds || 10));
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { provider: "MillionVerifier", status: "ERROR", httpStatus: response.status, error: body.error || body.message || "HTTP_ERROR" };
  const result = String(body.result || "").toLowerCase();
  let disposition = "REVIEW";
  if ((rules.verification.acceptedResults || []).includes(result)) disposition = "VERIFIED_OK";
  else if ((rules.verification.rejectedResults || []).includes(result)) disposition = "REJECTED";
  return {
    provider: "MillionVerifier",
    status: "COMPLETE",
    result,
    resultcode: body.resultcode ?? "",
    quality: body.quality ?? "",
    subresult: body.subresult ?? "",
    role: body.role ?? "",
    free: body.free ?? "",
    disposition
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, runner));
  return results;
}

async function discoverOne(row, rules, apiKey) {
  const uei = first(row, ["uei", "UEI"]);
  const legalName = first(row, ["legalName", "Legal_Name", "legal_name"]);
  const state = first(row, ["state", "State", "NORMALIZED_STATE"]);
  const domain = normalizeDomain(first(row, ["domain", "Domain", "website", "Website", "NORMALIZED_WEBSITE"]));
  const base = baseUrlFromRow(row);
  const attempted = [];
  let discovered = "";
  let sourceUrl = "";

  if (base) {
    const paths = (rules.execution.candidatePaths || ["/"]).slice(0, rules.execution.maxPagesPerDomain || 3);
    for (const suffix of paths) {
      let url;
      try { url = new URL(suffix, base).toString(); } catch { continue; }
      attempted.push(url);
      const fetched = await fetchText(url, rules.execution.requestTimeoutMs || 8000);
      if (!fetched.ok) continue;
      const candidates = extractEmails(fetched.text);
      discovered = chooseEmail(candidates, domain, rules);
      if (discovered) {
        sourceUrl = fetched.finalUrl || url;
        break;
      }
    }
  }

  const verification = discovered ? await verifyEmail(discovered, rules, apiKey) : { provider: "MillionVerifier", status: "NOT_RUN", reason: "NO_EMAIL_DISCOVERED" };

  return {
    uei,
    legalName,
    state,
    domain,
    discoveredEmail: discovered,
    discoveryStatus: discovered ? "DISCOVERED_PUBLIC_EMAIL" : (base ? "NO_PUBLIC_EMAIL_FOUND" : "NO_WEBSITE"),
    sourceUrl,
    pagesAttempted: attempted.length,
    verificationStatus: verification.status,
    verificationResult: verification.result || "",
    verificationDisposition: verification.disposition || "",
    verificationReason: verification.reason || verification.error || ""
  };
}

async function run(options = {}) {
  const rules = loadRules();
  const source = path.join(ROOT, rules.sourceQueue);
  if (!fs.existsSync(source)) throw new Error(`P1.3E source queue not found: ${source}`);
  const allRows = await readCsv(source);
  const requested = Number(options.limit || process.env.MILES_EMAIL_DISCOVERY_LIMIT || rules.execution.defaultLimit || 250);
  const limit = Math.min(Math.max(1, requested), rules.execution.maxLimit || 2500, allRows.length);
  const rows = allRows.slice(0, limit);
  const apiKey = getApiKey(rules);
  const results = await mapLimit(rows, rules.execution.concurrency || 5, row => discoverOne(row, rules, apiKey));

  const outDir = path.join(ROOT, rules.outputDir);
  const discoveredFile = path.join(outDir, "STATE_SLED_WAVE1_DISCOVERY_RESULTS.csv");
  const verifiedFile = path.join(outDir, "STATE_SLED_WAVE1_VERIFIED_OK.csv");
  const retryFile = path.join(outDir, "STATE_SLED_WAVE1_DISCOVERY_RETRY.csv");
  const auditFile = path.join(outDir, "STATE_SLED_WAVE1_EMAIL_DISCOVERY_AUDIT.json");

  const verified = results.filter(r => r.verificationDisposition === "VERIFIED_OK");
  const retry = results.filter(r => !r.discoveredEmail || r.verificationStatus !== "COMPLETE" || r.verificationDisposition === "REVIEW");
  writeCsv(discoveredFile, results);
  writeCsv(verifiedFile, verified);
  writeCsv(retryFile, retry);

  const stats = {
    source,
    generatedAt: new Date().toISOString(),
    queueTotal: allRows.length,
    processed: results.length,
    withWebsiteOrDomain: results.filter(r => r.domain).length,
    publicEmailsDiscovered: results.filter(r => r.discoveredEmail).length,
    noPublicEmailFound: results.filter(r => r.discoveryStatus === "NO_PUBLIC_EMAIL_FOUND").length,
    noWebsite: results.filter(r => r.discoveryStatus === "NO_WEBSITE").length,
    millionVerifierConfigured: !!apiKey,
    verifiedOk: verified.length,
    verificationReview: results.filter(r => r.verificationDisposition === "REVIEW").length,
    verificationRejected: results.filter(r => r.verificationDisposition === "REJECTED").length,
    verificationNotRun: results.filter(r => r.verificationStatus === "NOT_RUN").length,
    remainingInQueue: Math.max(0, allRows.length - results.length),
    safety: rules.safety
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(auditFile, JSON.stringify({ gate: rules.gate, rulesVersion: rules.version, stats, outputs: { discoveredFile, verifiedFile, retryFile, auditFile } }, null, 2));

  return { ok: true, gate: rules.gate, rulesVersion: rules.version, stats, outputs: { discoveredFile, verifiedFile, retryFile, auditFile } };
}

module.exports = { run, extractEmails, chooseEmail, normalizeDomain, verifyEmail };
