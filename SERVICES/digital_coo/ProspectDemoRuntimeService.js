"use strict";

const fs = require("fs");
const path = require("path");
const ProspectDemoTruthService = require("./ProspectDemoTruthService");

function key(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function safeKey(value) {
  return String(value || "prospect").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0,80) || "prospect";
}

class ProspectDemoRuntimeService {
  constructor(options = {}) {
    this.truthService = options.truthService || new ProspectDemoTruthService(options);
    this.ttlMs = Math.max(1000, Number(options.ttlMs || process.env.MILES_PROSPECT_DEMO_CACHE_MS || 300000));
    this.cache = new Map();
  }

  lookup(term) {
    const item = this.cache.get(key(term));
    if (!item) return null;
    if (Date.now() - item.cachedAt > this.ttlMs) {
      this.cache.delete(key(term));
      return null;
    }
    return item.truth;
  }

  sanitize(truth) {
    if (!truth || typeof truth !== "object") return truth;
    const out = JSON.parse(JSON.stringify(truth));
    out.request = { term: out.request?.term || null };
    if (out.evidence?.orion) {
      out.evidence.orion = {
        authority: out.evidence.orion.authority || "ORION_READ_ONLY",
        generatedAt: out.evidence.orion.generatedAt || null,
        dataQuality: out.evidence.orion.dataQuality || null
      };
    }
    if (Array.isArray(out.contacts?.records)) {
      out.contacts.records = out.contacts.records.map(contact => ({
        name: contact.name || null,
        email: contact.email || null,
        phone: contact.phone || null,
        source: contact.source || null
      }));
    }
    return out;
  }

  persistSanitized(truth) {
    const outDir = this.truthService.outDir;
    if (!outDir || !truth?.ok) return;
    const prospectKey = safeKey(truth.identity?.uei || truth.identity?.name || truth.request?.term);
    const dir = path.join(outDir, prospectKey);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(truth, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "latest.md"), this.truthService.renderMarkdown(truth), "utf8");
    fs.writeFileSync(path.join(dir, "latest.html"), this.truthService.renderHtml(truth), "utf8");
  }

  remember(term, truth) {
    const item = { cachedAt: Date.now(), truth };
    const aliases = [term, truth?.identity?.name, truth?.identity?.uei].map(key).filter(Boolean);
    for (const alias of aliases) this.cache.set(alias, item);
  }

  async build(term, options = {}) {
    if (!options.forceRefresh) {
      const cached = this.lookup(term);
      if (cached) return { ...cached, cache: { hit: true, ttlMs: this.ttlMs } };
    }
    const raw = await this.truthService.build(term, options);
    if (!raw?.ok) return raw;
    const truth = this.sanitize(raw);
    this.persistSanitized(truth);
    this.remember(term, truth);
    return { ...truth, cache: { hit: false, ttlMs: this.ttlMs } };
  }

  renderMarkdown(truth) { return this.truthService.renderMarkdown(this.sanitize(truth)); }
  renderHtml(truth) { return this.truthService.renderHtml(this.sanitize(truth)); }
}

module.exports = ProspectDemoRuntimeService;
module.exports.ProspectDemoRuntimeService = ProspectDemoRuntimeService;
