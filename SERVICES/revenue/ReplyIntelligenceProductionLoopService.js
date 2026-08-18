"use strict";

const fs = require("fs");
const path = require("path");
const ReplyIntelligenceService = require("./ReplyIntelligenceService");
const GlobalSuppressionService = require("./GlobalSuppressionService");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_MAX_PAGES = 5;
const MAX_PROCESSED_IDS = 10000;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function queueUpsert(filePath, entry, keyFn) {
  const existing = readJson(filePath, []);
  const rows = Array.isArray(existing) ? existing : [];
  const key = keyFn(entry);
  const index = rows.findIndex(row => keyFn(row) === key);
  if (index >= 0) rows[index] = { ...rows[index], ...entry };
  else rows.push(entry);
  writeJsonAtomic(filePath, rows);
  return rows.length;
}

function queueRemove(filePath, predicate) {
  const existing = readJson(filePath, []);
  const rows = Array.isArray(existing) ? existing : [];
  const filtered = rows.filter(row => !predicate(row));
  if (filtered.length !== rows.length) writeJsonAtomic(filePath, filtered);
  return rows.length - filtered.length;
}

class ReplyIntelligenceProductionLoopService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.intervalMs = positiveInt(options.intervalMs || process.env.P2GC_REPLY_INTELLIGENCE_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    this.lookbackDays = positiveInt(options.lookbackDays || process.env.P2GC_REPLY_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS);
    this.maxPages = positiveInt(options.maxPages || process.env.P2GC_REPLY_MAX_PAGES, DEFAULT_MAX_PAGES);
    this.emailSource = options.emailSource || null;
    this.classifier = options.classifier || new ReplyIntelligenceService();
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.rootDir });
    this.timer = null;
    this.running = false;
    this.passRunning = false;
    this.outputDir = options.outputDir || path.join(this.rootDir, "DATA", "runtime", "revenue", "replies");
    this.statePath = path.join(this.outputDir, "reply_intelligence_state.json");
    this.latestPath = path.join(this.outputDir, "reply_intelligence_latest.json");
    this.kpiPath = path.join(this.outputDir, "reply_kpis_latest.json");
    this.activityPath = path.join(this.outputDir, "reply_activity_log.jsonl");
    this.qualifiedQueuePath = path.join(this.outputDir, "qualified_reply_queue.json");
    this.followupQueuePath = path.join(this.outputDir, "followup_queue.json");
    this.reviewQueuePath = path.join(this.outputDir, "manual_review_queue.json");
    this.log = options.log || (message => console.log(`[REPLY-INTEL] ${message}`));
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

  initialState() {
    return {
      version: 1,
      processedIds: [],
      lastSuccessfulPollAt: null,
      cumulative: {
        rawReceived: 0,
        humanReplies: 0,
        meaningfulHumanReplies: 0,
        qualifiedPositiveReplies: 0,
        counts: {}
      },
      generatedAt: new Date().toISOString()
    };
  }

  loadState() {
    const state = readJson(this.statePath, this.initialState());
    return {
      ...this.initialState(),
      ...state,
      processedIds: Array.isArray(state?.processedIds) ? state.processedIds : [],
      cumulative: {
        ...this.initialState().cumulative,
        ...(state?.cumulative || {}),
        counts: { ...(state?.cumulative?.counts || {}) }
      }
    };
  }

  saveState(state) {
    state.processedIds = [...new Set(state.processedIds || [])].slice(-MAX_PROCESSED_IDS);
    state.generatedAt = new Date().toISOString();
    writeJsonAtomic(this.statePath, state);
  }

  async fetchReceivedEmails(state) {
    const source = this.getEmailSource();
    const firstMin = state.lastSuccessfulPollAt || new Date(Date.now() - this.lookbackDays * 86400000).toISOString();
    const items = [];
    let startingAfter = null;
    let pages = 0;

    while (pages < this.maxPages) {
      const params = {
        limit: 100,
        email_type: "received",
        min_timestamp_created: firstMin
      };
      if (startingAfter) params.starting_after = startingAfter;
      const response = await source.listEmails(params);
      const pageItems = Array.isArray(response?.items)
        ? response.items
        : Array.isArray(response)
          ? response
          : [];
      items.push(...pageItems);
      pages += 1;
      startingAfter = response?.next_starting_after || null;
      if (!startingAfter || pageItems.length === 0) break;
    }

    return { items, pages, minTimestamp: firstMin, truncated: Boolean(startingAfter) };
  }

  processClassification(item, classification) {
    const base = {
      ...classification,
      source: "INSTANTLY_UNIBOX",
      processedAt: new Date().toISOString()
    };
    appendJsonl(this.activityPath, base);

    const email = classification.from;
    const queueKey = row => `${String(row?.emailId || "")}|${String(row?.from || "").toLowerCase()}`;

    if (classification.qualifiedPositive) {
      queueUpsert(this.qualifiedQueuePath, { ...base, status: "OPEN", owner: "KEVIN" }, queueKey);
    }

    if (classification.category === "OOO" || classification.category === "NOT_NOW") {
      queueUpsert(this.followupQueuePath, { ...base, status: "SCHEDULED" }, queueKey);
    }

    if (classification.category === "NEUTRAL_QUESTION" || classification.category === "UNKNOWN") {
      queueUpsert(this.reviewQueuePath, { ...base, status: "OPEN", owner: "KEVIN" }, queueKey);
    }

    if (classification.hardSuppression && email) {
      this.suppression.upsert({
        email,
        reason: classification.category,
        category: classification.category,
        source: "INSTANTLY_UNIBOX",
        sourceId: classification.emailId,
        campaignId: classification.campaignId,
        evidence: `${classification.subject} ${classification.preview}`,
        hard: true
      });
      queueRemove(this.qualifiedQueuePath, row => String(row?.from || "").toLowerCase() === email);
      queueRemove(this.followupQueuePath, row => String(row?.from || "").toLowerCase() === email);
    }

    return base;
  }

  updateCumulative(state, summary) {
    const c = state.cumulative;
    c.rawReceived += Number(summary.rawReceived || 0);
    c.humanReplies += Number(summary.humanReplies || 0);
    c.meaningfulHumanReplies += Number(summary.meaningfulHumanReplies || 0);
    c.qualifiedPositiveReplies += Number(summary.qualifiedPositiveReplies || 0);
    for (const [category, count] of Object.entries(summary.counts || {})) {
      c.counts[category] = Number(c.counts[category] || 0) + Number(count || 0);
    }
    c.humanReplyRatePct = c.rawReceived ? Number(((c.humanReplies / c.rawReceived) * 100).toFixed(2)) : 0;
    c.qualifiedPositiveRatePct = c.humanReplies ? Number(((c.qualifiedPositiveReplies / c.humanReplies) * 100).toFixed(2)) : 0;
  }

  async runOnce() {
    if (this.passRunning) return { ok: true, status: "REPLY_INTELLIGENCE_PASS_ALREADY_RUNNING", skipped: true };
    this.passRunning = true;
    const state = this.loadState();
    try {
      const fetched = await this.fetchReceivedEmails(state);
      const processed = new Set(state.processedIds);
      const fresh = fetched.items.filter(item => {
        const id = String(item?.id || item?.message_id || "");
        return id && !processed.has(id);
      });

      const classified = fresh.map(item => ({ item, classification: this.classifier.classify(item) }));
      const routed = classified.map(({ item, classification }) => this.processClassification(item, classification));
      const summary = this.classifier.summarize(routed);
      this.updateCumulative(state, summary);

      for (const item of fresh) {
        const id = String(item?.id || item?.message_id || "");
        if (id) state.processedIds.push(id);
      }
      state.lastSuccessfulPollAt = new Date().toISOString();
      this.saveState(state);

      const report = {
        ok: true,
        service: "REPLY_INTELLIGENCE_PRODUCTION_LOOP",
        status: summary.qualifiedPositiveReplies > 0
          ? "QUALIFIED_REPLIES_REQUIRE_IMMEDIATE_REVIEW"
          : summary.humanReplies > 0
            ? "HUMAN_REPLIES_CLASSIFIED"
            : "NO_NEW_HUMAN_REPLIES",
        fetched: {
          rows: fetched.items.length,
          newRows: fresh.length,
          pages: fetched.pages,
          minTimestamp: fetched.minTimestamp,
          truncated: fetched.truncated
        },
        latest: summary,
        cumulative: state.cumulative,
        alerts: routed.filter(item => item.qualifiedPositive),
        suppressionsAddedOrConfirmed: routed.filter(item => item.hardSuppression).length,
        followupsScheduled: routed.filter(item => ["OOO", "NOT_NOW"].includes(item.category)).length,
        manualReview: routed.filter(item => ["NEUTRAL_QUESTION", "UNKNOWN"].includes(item.category)).length,
        queues: {
          qualified: this.qualifiedQueuePath,
          followup: this.followupQueuePath,
          review: this.reviewQueuePath,
          suppression: this.suppression.filePath
        },
        safety: {
          instantlyReadOnly: true,
          sendsExecuted: 0,
          repliesSent: 0,
          campaignMutations: 0,
          autoActivation: false
        },
        generatedAt: new Date().toISOString()
      };

      writeJsonAtomic(this.latestPath, report);
      writeJsonAtomic(this.kpiPath, {
        generatedAt: report.generatedAt,
        primaryFunnel: ["DELIVERED", "HUMAN_REPLIES", "QUALIFIED_POSITIVE_REPLIES", "MEETINGS", "HELD_MEETINGS", "BLUEPRINT_DEMOS", "PROPOSALS", "REVENUE"],
        rawReplyMetricDeprecated: true,
        latest: summary,
        cumulative: state.cumulative
      });
      this.log(`${report.status}; new=${fresh.length}; human=${summary.humanReplies}; qualified=${summary.qualifiedPositiveReplies}`);
      return report;
    } catch (error) {
      const report = {
        ok: false,
        service: "REPLY_INTELLIGENCE_PRODUCTION_LOOP",
        status: "REPLY_INTELLIGENCE_POLL_FAILED",
        error: error.stack || error.message,
        safety: { instantlyReadOnly: true, sendsExecuted: 0, repliesSent: 0, campaignMutations: 0 },
        generatedAt: new Date().toISOString()
      };
      writeJsonAtomic(this.latestPath, report);
      this.log(`${report.status}: ${error.message}`);
      return report;
    } finally {
      this.passRunning = false;
    }
  }

  start() {
    if (this.running) return { ok: true, status: "REPLY_INTELLIGENCE_LOOP_ALREADY_STARTED", intervalMs: this.intervalMs };
    this.running = true;
    Promise.resolve().then(() => this.runOnce()).catch(error => this.log(`Initial pass failed: ${error.message}`));
    this.timer = setInterval(() => this.runOnce().catch(error => this.log(`Scheduled pass failed: ${error.message}`)), this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    return {
      ok: true,
      status: "REPLY_INTELLIGENCE_LOOP_STARTED",
      intervalMs: this.intervalMs,
      instantlyReadOnly: true,
      autonomousRepliesAllowed: false
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    return { ok: true, status: "REPLY_INTELLIGENCE_LOOP_STOPPED" };
  }
}

module.exports = ReplyIntelligenceProductionLoopService;
module.exports.ReplyIntelligenceProductionLoopService = ReplyIntelligenceProductionLoopService;
module.exports.DEFAULT_INTERVAL_MS = DEFAULT_INTERVAL_MS;
module.exports.helpers = { positiveInt, readJson, writeJsonAtomic, appendJsonl, queueUpsert, queueRemove };
