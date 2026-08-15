"use strict";

const ProspectDemoTruthService = require("./ProspectDemoTruthService");

function key(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
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
    const truth = await this.truthService.build(term, options);
    if (truth?.ok) this.remember(term, truth);
    return truth?.ok ? { ...truth, cache: { hit: false, ttlMs: this.ttlMs } } : truth;
  }

  renderMarkdown(truth) { return this.truthService.renderMarkdown(truth); }
  renderHtml(truth) { return this.truthService.renderHtml(truth); }
}

module.exports = ProspectDemoRuntimeService;
module.exports.ProspectDemoRuntimeService = ProspectDemoRuntimeService;
