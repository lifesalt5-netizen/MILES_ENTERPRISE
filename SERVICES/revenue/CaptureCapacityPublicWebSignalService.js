"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_QUERIES = Object.freeze([
  '"capture manager" federal contractor hiring',
  '"business development manager" federal government contractor hiring',
  '"growth manager" federal contractor hiring',
  '"proposal manager" federal contractor hiring',
  '"federal pricing analyst" government contractor hiring'
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSpace(value) {
  return clean(value).replace(/\s+/g, " ");
}

function classify(text) {
  const value = String(text || "").toLowerCase();
  if (/capture manager|capture director|capture lead|capture analyst|capture executive/.test(value)) return "CAPTURE_HIRING";
  if (/business development manager|business development director|bd manager|bd director|growth manager|growth director|growth executive/.test(value)) return "BD_CAPTURE_OPENING";
  if (/proposal manager|proposal director|proposal lead|proposal writer|proposal development/.test(value)) return "BD_CAPTURE_OPENING";
  if (/federal pricing analyst|pricing analyst|price.to.win/.test(value)) return "BD_CAPTURE_OPENING";
  return null;
}

function companyFromTitle(title) {
  const value = normalizeSpace(title);
  if (!value) return "";

  // Common ATS/search title shape: "Role - Company - Career Page".
  const parts = value.split(/\s+-\s+/).map(clean).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0].toLowerCase();
    if (/capture|business development|growth|proposal|pricing/.test(first)) {
      const candidates = parts.slice(1).filter(part => !/career page|careers|jobs?|apply/i.test(part));
      if (candidates.length) return candidates[0];
    }
  }

  // Alternate title shape: "Company hiring Role" or "Role at Company".
  let match = value.match(/^(.+?)\s+(?:is\s+)?hiring\s+(?:an?\s+)?(?:capture|business development|growth|proposal|pricing)/i);
  if (match) return clean(match[1]);
  match = value.match(/^(?:capture|business development|growth|proposal|pricing)[^@-]*\s+at\s+(.+)$/i);
  if (match) return clean(match[1]);

  return "";
}

function dateFromResult(result = {}) {
  return clean(result.published_date || result.publishedDate || result.date || "");
}

class CaptureCapacityPublicWebSignalService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.apiKey = clean(options.apiKey || process.env.TAVILY_API_KEY);
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.queries = Array.isArray(options.queries) && options.queries.length ? options.queries : [...DEFAULT_QUERIES];
    this.maxResults = Math.max(1, Math.min(20, Number(options.maxResults || process.env.CAPTURE_CAPACITY_PUBLIC_SEARCH_MAX_RESULTS || 8)));
    this.timeRange = clean(options.timeRange || process.env.CAPTURE_CAPACITY_PUBLIC_SEARCH_TIME_RANGE || "month");
    this.outputFile = options.outputFile || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "capture_capacity",
      "signals",
      "public_web_signals_latest.json"
    );
    this.reportFile = options.reportFile || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "capture_capacity",
      "public_web_signal_search_latest.json"
    );
  }

  writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temp, file);
    return file;
  }

  normalizeResult(result = {}, query = "") {
    const title = normalizeSpace(result.title);
    const content = normalizeSpace(result.content || result.snippet || result.description);
    const sourceUrl = clean(result.url);
    const triggerType = classify(`${title} ${content}`);
    const company = companyFromTitle(title);

    if (!sourceUrl || !triggerType || !company) return null;

    return {
      company,
      trigger_type: triggerType,
      title,
      evidence: normalizeSpace(`${title}. ${content}`).slice(0, 1800),
      source_url: sourceUrl,
      posted_date: dateFromResult(result),
      search_query: query,
      source_provider: "TAVILY",
      source_type: "PUBLIC_WEB_SEARCH",
      retrieved_at: new Date().toISOString(),
      evidence_status: "PUBLIC_SOURCE_DISCOVERED_REQUIRES_STANDARD_IDENTITY_GATE"
    };
  }

  async search(query) {
    if (!this.fetchImpl) throw new Error("Global fetch is unavailable");

    const response = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: this.maxResults,
        time_range: this.timeRange,
        include_answer: false,
        include_raw_content: false
      })
    });

    if (!response || response.ok !== true) {
      const status = response?.status || "NO_STATUS";
      let body = "";
      try { body = await response.text(); } catch {}
      throw new Error(`Tavily search failed status=${status}${body ? ` body=${body.slice(0, 300)}` : ""}`);
    }

    const payload = await response.json();
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  async runOnce() {
    const generatedAt = new Date().toISOString();

    if (!this.apiKey) {
      const report = {
        ok: true,
        status: "PUBLIC_WEB_SEARCH_NOT_CONFIGURED",
        provider: "TAVILY",
        configured: false,
        queriesAttempted: 0,
        rawResults: 0,
        usableSignals: 0,
        outputFile: this.outputFile,
        generatedAt
      };
      report.artifact = this.writeJson(this.reportFile, report);
      return report;
    }

    const signals = [];
    const errors = [];
    let rawResults = 0;

    for (const query of this.queries) {
      try {
        const results = await this.search(query);
        rawResults += results.length;
        for (const result of results) {
          const normalized = this.normalizeResult(result, query);
          if (normalized) signals.push(normalized);
        }
      } catch (error) {
        errors.push({ query, error: error.message });
      }
    }

    const unique = new Map();
    for (const signal of signals) {
      const key = `${signal.company.toLowerCase()}|${signal.trigger_type}|${signal.source_url.toLowerCase()}`;
      if (!unique.has(key)) unique.set(key, signal);
    }
    const rows = [...unique.values()];

    this.writeJson(this.outputFile, {
      generatedAt,
      provider: "TAVILY",
      records: rows
    });

    const report = {
      ok: errors.length < this.queries.length,
      status: rows.length > 0
        ? "PUBLIC_WEB_SIGNALS_REFRESHED"
        : errors.length === this.queries.length
          ? "PUBLIC_WEB_SEARCH_FAILED"
          : "PUBLIC_WEB_SEARCH_NO_USABLE_SIGNALS",
      provider: "TAVILY",
      configured: true,
      queriesAttempted: this.queries.length,
      rawResults,
      usableSignals: rows.length,
      errors,
      outputFile: this.outputFile,
      generatedAt
    };
    report.artifact = this.writeJson(this.reportFile, report);
    return report;
  }
}

module.exports = CaptureCapacityPublicWebSignalService;
module.exports.DEFAULT_QUERIES = DEFAULT_QUERIES;
module.exports.helpers = { clean, normalizeSpace, classify, companyFromTitle, dateFromResult };
