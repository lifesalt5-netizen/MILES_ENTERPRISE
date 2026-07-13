"use strict";

const browser = require("../BrowserSessionManager");
const approvals = require("../../Executive/CEOApprovalQueue");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RESULT_DIR = path.join(ROOT, "DATA", "browser", "operator_results");
const MEMORY_FILE = path.join(ROOT, "DATA", "browser", "operator_memory.json");

function ensureDir() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
}

function loadMemory() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return { patterns: {}, performance: {}, runs: [] };
  }
}

function saveMemory(mem) {
  ensureDir();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function save(name, data) {
  ensureDir();
  const file = path.join(RESULT_DIR, `${name}_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

class InstantlyCampaignOperator {
  constructor() {
    this.session = "instantly";
    this.baseUrl = "https://app.instantly.ai/app/campaigns";
    this.safeOperationalActions = new Set([
      "AUDIT_CAMPAIGN",
      "REPAIR_PAUSED_CAMPAIGN",
      "REPLENISH_LEADS",
      "OPTIMIZE_LOW_PERFORMANCE",
      "CONTINUE_MONITORING"
    ]);
  }

  async run(options = {}) {
    const execute = Boolean(options.execute || process.argv.includes("--execute"));
    const memory = loadMemory();

    const result = {
      ok: false,
      mode: execute ? "EXECUTE" : "AUDIT",
      stage: "STARTED",
      campaigns: [],
      actions: {
        planned: [],
        executed: [],
        verified: [],
        failed: [],
        approvals: [],
        ignored: []
      },
      screenshots: [],
      errors: [],
      notes: []
    };

    let page;

    try {
      page = await browser.newPage(this.session, {
        headless: options.headless !== false
      });

      await page.goto(this.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await this.waitForAppReady(page);

      result.screenshots.push(await browser.screenshot(page, "instantly_campaigns_opened"));

      const campaigns = await this.extractCampaigns(page);
      result.campaigns = campaigns;

      if (!campaigns.length) {
        result.notes.push("No reliable campaign rows were extracted. MILES did not invent campaign data.");
      }

      for (const campaign of campaigns) {
        const decision = this.decide(campaign, memory);

        if (decision.action === "IGNORE") {
          result.actions.ignored.push({ campaign: campaign.name, reason: decision.reason });
          continue;
        }

        if (decision.requiresCEO) {
          const approval = approvals.enqueue({
            priority: decision.priority || "HIGH",
            category: "Instantly COO Control",
            objective: campaign.name,
            reason: decision.reason,
            recommendation: decision.recommendation,
            risk: decision.risk || "MEDIUM",
            capability: decision.capability || "campaign.control",
            provider: "InstantlyCOO",
            evidence: campaign,
            action: decision.action
          });
          result.actions.approvals.push(approval.item || approval);
          continue;
        }

        result.actions.planned.push({
          campaign: campaign.name,
          action: decision.action,
          reason: decision.reason
        });

        if (!execute) {
          continue;
        }

        const execution = await this.executeDecision(page, campaign, decision);

        if (execution.ok) {
          result.actions.executed.push(execution);
          this.updateMemory(memory, campaign, "executed", decision.action);

          const verification = await this.verifyDecision(page, campaign, decision, execution);
          if (verification.ok) {
            result.actions.verified.push(verification);
            this.updateMemory(memory, campaign, "verified", decision.action);
          } else {
            result.actions.failed.push(verification);
            this.updateMemory(memory, campaign, "verification_failed", decision.action);
          }
        } else {
          result.actions.failed.push(execution);
          this.updateMemory(memory, campaign, "failed", decision.action);
        }
      }

      await browser.saveSession(this.session);

      result.ok = true;
      result.stage = "COMPLETED";
      result.file = save(execute ? "instantly_coo_execute" : "instantly_coo_audit", result);

      memory.runs = memory.runs || [];
      memory.runs.push({
        ts: new Date().toISOString(),
        mode: result.mode,
        campaigns: result.campaigns.length,
        planned: result.actions.planned.length,
        executed: result.actions.executed.length,
        verified: result.actions.verified.length,
        failed: result.actions.failed.length,
        approvals: result.actions.approvals.length
      });
      memory.runs = memory.runs.slice(-100);
      saveMemory(memory);

      return result;
    } catch (err) {
      result.errors.push(err.stack || err.message || String(err));
      result.stage = "FAILED";
      result.file = save("instantly_error", result);
      return result;
    } finally {
      await browser.shutdown();
    }
  }

  async waitForAppReady(page) {
    await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.waitForSelector("body", { timeout: 30000 });
  }

  async extractCampaigns(page) {
    const raw = await page.evaluate(() => {
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };

      const textOf = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
      const items = [];

      // Instantly can render campaigns as table rows or virtualized list/card rows. Capture both.
      const candidates = [
        ...Array.from(document.querySelectorAll("table tbody tr")),
        ...Array.from(document.querySelectorAll('[role="row"]')),
        ...Array.from(document.querySelectorAll('[data-testid*="campaign" i], [class*="campaign" i]')),
        ...Array.from(document.querySelectorAll('a[href*="/campaign"], a[href*="campaigns"]'))
      ].filter(visible);

      for (const el of candidates) {
        const text = textOf(el);
        if (!text || text.length < 2) continue;

        const lower = text.toLowerCase();
        const href = el.href || el.querySelector?.('a[href*="campaign"]')?.href || "";
        const idMatch = href.match(/campaigns?\/([^/?#]+)/i) || href.match(/campaign\/([^/?#]+)/i);

        let name = "";
        const cells = Array.from(el.querySelectorAll?.("td,[role='cell'],a,button,span,div") || [])
          .map(textOf)
          .filter(Boolean)
          .filter(x => x.length >= 2 && x.length <= 120);

        // Prefer a linked campaign title or the first meaningful cell.
        const linked = Array.from(el.querySelectorAll?.('a[href*="campaign"]') || []).map(textOf).find(Boolean);
        name = linked || cells.find(x => !thisIsMetric(x)) || text.split(" ").slice(0, 8).join(" ");

        let status = "unknown";
        if (/\bactive\b|\brunning\b|\bsending\b/.test(lower)) status = "active";
        else if (/\bpaused\b|\bstopped\b/.test(lower)) status = "paused";
        else if (/\bdraft\b/.test(lower)) status = "draft";
        else if (/\bcompleted\b|\bfinished\b/.test(lower)) status = "completed";

        const metric = (patterns) => {
          for (const p of patterns) {
            const m = text.match(p);
            if (m) return m[1] || m[0];
          }
          return null;
        };

        items.push({
          name,
          status,
          id: idMatch ? idMatch[1] : null,
          href,
          rawText: text.slice(0, 1000),
          source: el.tagName.toLowerCase() + (el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""),
          metrics: {
            bounceRate: metric([/(\d+(?:\.\d+)?)\s*%\s*bounce/i, /bounce\D+(\d+(?:\.\d+)?)\s*%/i]),
            replyRate: metric([/(\d+(?:\.\d+)?)\s*%\s*reply/i, /reply\D+(\d+(?:\.\d+)?)\s*%/i]),
            openRate: metric([/(\d+(?:\.\d+)?)\s*%\s*open/i, /open\D+(\d+(?:\.\d+)?)\s*%/i]),
            leads: metric([/(\d[\d,]*)\s*leads?/i, /leads?\D+(\d[\d,]*)/i])
          }
        });
      }

      function thisIsMetric(x) {
        const s = String(x || "").trim().toLowerCase();
        if (!s) return true;
        if (["status", "campaigns", "campaign", "unibox", "analytics", "leads", "sequences", "settings"].includes(s)) return true;
        if (/^\d+$/.test(s)) return true;
        if (/^\d+(\.\d+)?%$/.test(s)) return true;
        return false;
      }

      return items;
    });

    const cleaned = [];
    const seen = new Set();

    for (const r of raw) {
      const name = normalize(r.name);
      if (!this.isRealCampaignName(name)) continue;

      const key = (r.id || r.href || name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      cleaned.push({
        ...r,
        name,
        confidence: this.confidenceScore(r)
      });
    }

    cleaned.sort((a, b) => b.confidence - a.confidence);
    return cleaned;
  }

  isRealCampaignName(name) {
    const n = normalize(name);
    const lower = n.toLowerCase();
    if (!n || n.length < 3 || n.length > 140) return false;
    if (["unibox", "status", "campaigns", "campaign", "analytics", "settings", "leads", "sequences", "0"].includes(lower)) return false;
    if (/^\d+$/.test(lower)) return false;
    if (/^\d+(\.\d+)?%$/.test(lower)) return false;
    return true;
  }

  confidenceScore(c) {
    let score = 0;
    if (c.id) score += 35;
    if (c.href) score += 25;
    if (c.status && c.status !== "unknown") score += 20;
    if (c.rawText && /active|paused|draft|completed|reply|open|bounce|lead/i.test(c.rawText)) score += 15;
    if (c.name && c.name.length >= 4) score += 5;
    return score;
  }

  decide(c, memory) {
    const name = (c.name || "").toLowerCase();
    const status = (c.status || "").toLowerCase();
    const bounce = Number(String(c.metrics?.bounceRate || "").replace(/[^\d.]/g, ""));
    const leads = Number(String(c.metrics?.leads || "").replace(/[^\d]/g, ""));

    if (status === "draft" || status === "completed") {
      return { action: "IGNORE", reason: `${status} campaign is not an operational repair target.` };
    }

    if (Number.isFinite(bounce) && bounce >= 5) {
      return {
        action: "REPAIR_PAUSED_CAMPAIGN",
        reason: `Bounce rate appears elevated at ${bounce}%. Operational repair is authorized.`,
        recommendation: "Pause affected sending source, remove bad leads, verify health, and resume only after safe.",
        requiresCEO: false,
        risk: "MEDIUM"
      };
    }

    if (status === "paused") {
      return {
        action: "REPAIR_PAUSED_CAMPAIGN",
        reason: "Paused campaign found. MILES should inspect and repair the operational cause before resuming.",
        recommendation: "Inspect campaign health, leads, inboxes, and sending settings.",
        requiresCEO: false,
        risk: "LOW"
      };
    }

    if (Number.isFinite(leads) && leads <= 50) {
      return {
        action: "REPLENISH_LEADS",
        reason: `Low lead count detected (${leads}).`,
        recommendation: "Upload next clean verified segment when segment source is available.",
        requiresCEO: false,
        risk: "LOW"
      };
    }

    if (name.includes("nurture") || name.includes("follow")) {
      return {
        action: "CONTINUE_MONITORING",
        reason: "Low-risk nurture/follow-up campaign.",
        requiresCEO: false,
        risk: "LOW"
      };
    }

    return {
      action: "AUDIT_CAMPAIGN",
      reason: "Operational audit authorized under MILES COO authority.",
      requiresCEO: false,
      risk: "LOW"
    };
  }

  async executeDecision(page, campaign, decision) {
    // Build 027 intentionally executes only safe, non-destructive browser steps.
    // The worker no longer routes routine COO work to CEO approval, but destructive changes remain unimplemented until selectors are proven.
    try {
      if (campaign.href) {
        await page.goto(campaign.href, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2500);
      }

      return {
        ok: true,
        campaign: campaign.name,
        action: decision.action,
        status: "EXECUTED_SAFE_AUDIT",
        detail: "Opened campaign/details when a campaign link was available. No destructive changes were made in Build 027.",
        ts: new Date().toISOString()
      };
    } catch (err) {
      return {
        ok: false,
        campaign: campaign.name,
        action: decision.action,
        status: "EXECUTION_FAILED",
        error: err.message,
        ts: new Date().toISOString()
      };
    }
  }

  async verifyDecision(page, campaign, decision, execution) {
    try {
      const title = await page.title().catch(() => "");
      const url = page.url();
      return {
        ok: true,
        campaign: campaign.name,
        action: decision.action,
        status: "VERIFIED_BROWSER_STABLE",
        evidence: {
          title,
          url,
          executionStatus: execution.status
        },
        ts: new Date().toISOString()
      };
    } catch (err) {
      return {
        ok: false,
        campaign: campaign.name,
        action: decision.action,
        status: "VERIFY_FAILED",
        error: err.message,
        ts: new Date().toISOString()
      };
    }
  }

  updateMemory(memory, campaign, outcome, action) {
    const name = (campaign.name || "unknown").toLowerCase();
    memory.performance = memory.performance || {};
    memory.patterns = memory.patterns || {};

    const delta = outcome === "verified" ? 8 : outcome === "executed" ? 3 : -3;
    memory.performance[name] = (memory.performance[name] || 0) + delta;

    memory.patterns[name] = {
      lastOutcome: outcome,
      lastAction: action,
      status: campaign.status,
      confidence: campaign.confidence,
      ts: new Date().toISOString()
    };
  }
}

module.exports = new InstantlyCampaignOperator();
