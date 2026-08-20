"use strict";

const path = require("path");
const ReplyIntelligenceProductionLoopService = require("./ReplyIntelligenceProductionLoopService");
const ReplacementContactRecoveryService = require("./ReplacementContactRecoveryService");

const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_MAX_PAGES = 10;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

class ReplacementContactBackfillService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.lookbackDays = positiveInt(options.lookbackDays || process.env.P2GC_REPLACEMENT_BACKFILL_DAYS, DEFAULT_LOOKBACK_DAYS);
    this.maxPages = positiveInt(options.maxPages || process.env.P2GC_REPLACEMENT_BACKFILL_MAX_PAGES, DEFAULT_MAX_PAGES);
    this.emailSource = options.emailSource || null;
    this.detector = options.detector || new ReplacementContactRecoveryService();
    this.replyLoop = options.replyLoop || new ReplyIntelligenceProductionLoopService({
      rootDir: this.rootDir,
      emailSource: this.emailSource,
      log: options.log || (() => {})
    });
  }

  getEmailSource() {
    if (this.emailSource) return this.emailSource;
    const instantly = require(path.join(this.rootDir, "CONNECTORS", "INSTANTLY", "instantly.js"));
    return {
      async listEmails(params) {
        return instantly.request("/emails", { method: "GET", params });
      }
    };
  }

  async fetchRecentReceived() {
    const source = this.getEmailSource();
    const minTimestamp = new Date(Date.now() - this.lookbackDays * 86400000).toISOString();
    const items = [];
    let startingAfter = null;
    let pages = 0;

    while (pages < this.maxPages) {
      const params = { limit: 100, email_type: "received", min_timestamp_created: minTimestamp };
      if (startingAfter) params.starting_after = startingAfter;
      const response = await source.listEmails(params);
      const pageItems = Array.isArray(response?.items) ? response.items : Array.isArray(response) ? response : [];
      items.push(...pageItems);
      pages += 1;
      startingAfter = response?.next_starting_after || null;
      if (!startingAfter || pageItems.length === 0) break;
    }

    return { items, pages, minTimestamp, truncated: Boolean(startingAfter) };
  }

  async runOnce() {
    const fetched = await this.fetchRecentReceived();
    const recovered = [];
    let detected = 0;

    for (const item of fetched.items) {
      const evidence = this.detector.detect(item);
      if (!evidence) continue;
      detected += 1;

      const classification = this.replyLoop.classifier.classify(item);
      const key = ReplyIntelligenceProductionLoopService.helpers.conversationKey(classification);
      const base = {
        ...classification,
        conversationKey: key,
        source: "INSTANTLY_UNIBOX_BACKFILL",
        processedAt: new Date().toISOString()
      };
      const recovery = this.replyLoop.recoverReplacementContact(item, classification, base);
      if (recovery) recovered.push(recovery);
    }

    return {
      ok: true,
      service: "REPLACEMENT_CONTACT_BACKFILL",
      status: recovered.length > 0 ? "REPLACEMENT_CONTACTS_RECOVERED" : "NO_REPLACEMENT_CONTACTS_FOUND",
      lookbackDays: this.lookbackDays,
      fetched: {
        rows: fetched.items.length,
        pages: fetched.pages,
        minTimestamp: fetched.minTimestamp,
        truncated: fetched.truncated
      },
      detected,
      recovered: recovered.length,
      queuePath: this.replyLoop.replacementQueuePath,
      suppressionPath: this.replyLoop.suppression.filePath,
      instantlyReadOnly: true,
      externalMutations: 0,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = ReplacementContactBackfillService;
module.exports.ReplacementContactBackfillService = ReplacementContactBackfillService;
module.exports.DEFAULT_LOOKBACK_DAYS = DEFAULT_LOOKBACK_DAYS;
module.exports.DEFAULT_MAX_PAGES = DEFAULT_MAX_PAGES;
