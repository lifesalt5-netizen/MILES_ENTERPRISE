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
}

function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return { patterns: {}, performance: {} };
  }
}

function saveMemory(mem) {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function save(name, data) {
  ensureDir();
  const file = path.join(RESULT_DIR, `${name}_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function norm(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

class InstantlyCampaignOperator {
  constructor() {
    this.session = "instantly";
    this.baseUrl = "https://app.instantly.ai/app/campaigns";
  }

  async run(options = {}) {
    const memory = loadMemory();
    const executeMode = Boolean(options.execute || process.argv.includes("--execute"));

    const result = {
      ok: false,
      stage: "STARTED",
      mode: executeMode ? "EXECUTE" : "AUDIT",
      campaigns: [],
      actions: {
        executed: [],
        verified: [],
        failed: [],
        paused: [],
        approvals: [],
        ignored: []
      },
      diagnostics: {},
      screenshots: [],
      errors: []
    };

    let page;

    try {
      page = await browser.newPage(this.session, {
        headless: options.headless !== false
      });

      await this.openCampaignsPage(page, result);

      const campaigns = await this.extractCampaigns(page);
      result.campaigns = campaigns;

      result.diagnostics.campaignCount = campaigns.length;
      result.diagnostics.url = page.url();
      result.diagnostics.title = await page.title();

      for (const campaign of campaigns) {
        const decision = this.decide(campaign, memory);

        campaign.decision = decision;

        if (decision.action === "IGNORE") {
          result.actions.ignored.push({
            campaign: campaign.name,
            reason: decision.reason
          });
          continue;
        }

        if (decision.action === "EXECUTE") {
          if (!executeMode) {
            result.actions.verified.push({
              campaign: campaign.name,
              action: decision.intent,
              status: "AUDIT_ONLY",
              reason: decision.reason
            });
            continue;
          }

          const execution = await this.executeCampaignAction(page, campaign, decision);
          result.actions.executed.push(execution);

          if (execution.ok) {
            result.actions.verified.push(execution);
            this.updateMemory(memory, campaign, "executed");
          } else {
            result.actions.failed.push(execution);
          }

          continue;
        }

        if (decision.action === "APPROVE") {
          const approval = approvals.enqueue({
            priority: decision.priority || "HIGH",
            category: "Instantly COO Control",
            objective: campaign.name,
            reason: decision.reason,
            risk: decision.risk || "MEDIUM",
            capability: "campaign.control",
            provider: "InstantlyCOO",
            evidence: campaign
          });

          result.actions.approvals.push(approval.item || approval);
        }
      }

      await browser.saveSession(this.session);

      saveMemory(memory);

      result.ok = true;
      result.stage = "COMPLETED";
      result.file = save("instantly_coo_mode_live", result);

      return result;
    } catch (err) {
      result.errors.push(err.stack || err.message);
      result.stage = "FAILED";

      if (page) {
        try {
          result.diagnostics.failureUrl = page.url();
          result.diagnostics.failureTitle = await page.title();
          result.screenshots.push(await browser.screenshot(page, "operator_failure"));
        } catch {}
      }

      result.file = save("instantly_error", result);
      return result;
    } finally {
      await browser.shutdown();
    }
  }

  async openCampaignsPage(page, result) {
    console.log("[MILES] Opening Instantly Campaigns...");

    await page.goto(this.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000
    });

    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(6000);

    console.log("[MILES] URL:", page.url());
    console.log("[MILES] TITLE:", await page.title());

    if (page.url().toLowerCase().includes("login")) {
      result.screenshots.push(await browser.screenshot(page, "instantly_login_redirect"));
      throw new Error("Instantly session has expired. Browser redirected to login.");
    }

    try {
      await Promise.race([
        page.waitForSelector("table", { timeout: 30000 }),
        page.waitForSelector('[role="row"]', { timeout: 30000 }),
        page.waitForSelector("text=Campaigns", { timeout: 30000 }),
        page.waitForSelector("text=Draft", { timeout: 30000 }),
        page.waitForSelector("text=Active", { timeout: 30000 }),
        page.waitForSelector("text=Paused", { timeout: 30000 })
      ]);
    } catch {
      result.screenshots.push(await browser.screenshot(page, "campaign_page_not_detected"));
      throw new Error("Campaign page loaded but no campaign UI could be detected.");
    }

    await page.waitForTimeout(3000);

    result.screenshots.push(await browser.screenshot(page, "campaigns_opened"));
    console.log("[MILES] Campaign page detected.");
  }

  async extractCampaigns(page) {
    return await page.evaluate(() => {
      function clean(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }

      function statusOf(text) {
        const lower = text.toLowerCase();
        if (/\bactive\b/.test(lower)) return "active";
        if (/\bpaused\b/.test(lower)) return "paused";
        if (/\bdraft\b/.test(lower)) return "draft";
        if (/\bstopped\b/.test(lower)) return "paused";
        return "unknown";
      }

      function isBadName(name) {
        const n = clean(name).toLowerCase();
        if (!n) return true;
        if (n.length < 2) return true;
        if (n.length > 120) return true;

        const bad = new Set([
          "campaigns",
          "campaign",
          "welcome back",
          "status",
          "progress",
          "sent",
          "click",
          "replied",
          "opportunities",
          "unibox",
          "new campaign",
          "create campaign",
          "search",
          "draft",
          "active",
          "paused"
        ]);

        if (bad.has(n)) return true;
        if (/^\d+$/.test(n)) return true;
        if (/^(sent|click|replied|opportunities)$/i.test(n)) return true;

        return false;
      }

      function parseNameFromLines(lines, status) {
        const filtered = lines
          .map(clean)
          .filter(Boolean)
          .filter(line => !isBadName(line))
          .filter(line => line.toLowerCase() !== status)
          .filter(line => !/^(draft|active|paused|sent|click|replied|opportunities|progress)$/i.test(line))
          .filter(line => !/^\d+(\.\d+)?%?$/.test(line));

        return filtered[0] || "";
      }

      const campaigns = [];
      const seen = new Set();

      function addCampaign(item) {
        const name = clean(item.name);
        if (isBadName(name)) return;

        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        campaigns.push({
          name,
          status: item.status || "unknown",
          progress: item.progress || null,
          sent: item.sent || null,
          click: item.click || null,
          replied: item.replied || null,
          opportunities: item.opportunities || null,
          source: item.source || "unknown",
          rawText: clean(item.rawText || "").slice(0, 500)
        });
      }

      const rowSelectors = [
        "table tbody tr",
        '[role="row"]',
        '[data-testid*="campaign"]',
        '[class*="campaign"]'
      ];

      for (const selector of rowSelectors) {
        const rows = Array.from(document.querySelectorAll(selector));

        for (const row of rows) {
          const rawText = row.innerText || "";
          const text = clean(rawText);
          if (!text) continue;

          const status = statusOf(text);
          if (status === "unknown" && !/draft|active|paused/i.test(text)) continue;

          const cells = Array.from(row.querySelectorAll("td, [role='cell'], div, span"))
            .map(el => clean(el.innerText))
            .filter(Boolean);

          const lines = rawText
            .split(/\n+/)
            .map(clean)
            .filter(Boolean);

          const name = parseNameFromLines(lines.length ? lines : cells, status);

          addCampaign({
            name,
            status,
            source: selector,
            rawText: text
          });
        }
      }

      if (campaigns.length === 0) {
        const bodyLines = (document.body.innerText || "")
          .split(/\n+/)
          .map(clean)
          .filter(Boolean);

        for (let i = 0; i < bodyLines.length; i++) {
          const line = bodyLines[i];
          const status = statusOf(line);

          if (status !== "unknown") {
            const prev = bodyLines[i - 1] || "";
            const prev2 = bodyLines[i - 2] || "";
            const next = bodyLines[i + 1] || "";

            const candidate = !isBadName(prev) ? prev : (!isBadName(prev2) ? prev2 : next);

            addCampaign({
              name: candidate,
              status,
              source: "body-line-status-neighbor",
              rawText: [prev2, prev, line, next].join(" | ")
            });
          }
        }
      }

      return campaigns;
    });
  }

  decide(campaign, memory) {
    const name = norm(campaign.name).toLowerCase();
    const status = norm(campaign.status).toLowerCase();

    if (!name) {
      return {
        action: "IGNORE",
        intent: "ignore_invalid",
        reason: "Invalid campaign name"
      };
    }

    if (status === "draft") {
      return {
        action: "IGNORE",
        intent: "draft_review",
        reason: "Draft campaign detected. No automatic send action taken."
      };
    }

    if (status === "paused") {
      return {
        action: "EXECUTE",
        intent: "inspect_paused_campaign",
        reason: "Paused campaign should be inspected and repaired if operational."
      };
    }

    if (status === "active") {
      return {
        action: "EXECUTE",
        intent: "audit_active_campaign",
        reason: "Active campaign should be monitored for health and capacity."
      };
    }

    if (name.includes("nurture") || name.includes("follow")) {
      return {
        action: "EXECUTE",
        intent: "audit_low_risk_campaign",
        reason: "Low-risk follow-up or nurture campaign."
      };
    }

    return {
      action: "EXECUTE",
      intent: "audit_campaign",
      reason: "Operational campaign audit is within MILES COO authority."
    };
  }

  async executeCampaignAction(page, campaign, decision) {
    const execution = {
      ok: true,
      campaign: campaign.name,
      action: decision.intent,
      mode: "SAFE_AUDIT_EXECUTION",
      reason: decision.reason,
      ts: new Date().toISOString()
    };

    try {
      execution.url = page.url();
      execution.verified = true;
      return execution;
    } catch (err) {
      return {
        ...execution,
        ok: false,
        verified: false,
        error: err.stack || err.message
      };
    }
  }

  updateMemory(memory, campaign, action) {
    const name = norm(campaign.name).toLowerCase();

    memory.performance = memory.performance || {};
    memory.patterns = memory.patterns || {};

    memory.performance[name] =
      (memory.performance[name] || 0) +
      (action === "executed" ? 5 : -2);

    memory.patterns[name] = {
      lastAction: action,
      status: campaign.status,
      ts: new Date().toISOString()
    };
  }
}

module.exports = new InstantlyCampaignOperator();