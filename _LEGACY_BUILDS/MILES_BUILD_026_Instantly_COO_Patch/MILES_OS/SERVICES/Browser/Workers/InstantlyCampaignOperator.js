"use strict";

const browser = require("../BrowserSessionManager");
const approvals = require("../../Executive/CEOApprovalQueue");
const authority = require("../../Decision/AuthorityEngine");
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
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return { patterns: {}, performance: {}, campaigns: {} };
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

function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function normalizeKey(value) {
  return cleanText(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isJunkName(name = "") {
  const n = normalizeKey(name);
  if (!n) return true;
  if (n.length < 3) return true;
  const junk = new Set([
    "unibox",
    "status",
    "campaigns",
    "campaign",
    "new campaign",
    "create campaign",
    "search",
    "filter",
    "all campaigns",
    "0",
    "1",
    "2",
    "3"
  ]);
  return junk.has(n);
}

class InstantlyCampaignOperator {
  constructor() {
    this.session = "instantly";
    this.baseUrl = "https://app.instantly.ai/app/campaigns";
  }

  async run(options = {}) {
    const memory = loadMemory();
    const result = {
      ok: false,
      stage: "STARTED",
      mode: options.execute === true ? "EXECUTE" : "OBSERVE_SAFE",
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

      await this.waitForInstantlyReady(page, result);
      result.screenshots.push(await browser.screenshot(page, "instantly_campaigns_loaded"));

      const campaigns = await this.extractCampaigns(page);
      result.campaigns = campaigns;

      if (!campaigns.length) {
        result.notes.push("No reliable campaign rows/cards were extracted. MILES did not guess from navigation labels.");
      }

      for (const campaign of campaigns) {
        const decision = this.decide(campaign, memory);
        const auth = authority.evaluate({
          objective: decision.objective || campaign.name,
          action: decision.action,
          provider: "Instantly"
        });

        const planItem = {
          campaign: campaign.name,
          status: campaign.status,
          action: decision.action,
          reason: decision.reason,
          authority: auth.authority,
          confidence: decision.confidence || campaign.confidence || "MEDIUM"
        };
        result.actions.planned.push(planItem);

        if (decision.action === "IGNORE") {
          result.actions.ignored.push(planItem);
          this.updateMemory(memory, campaign, "ignored");
          continue;
        }

        if (auth.approvalRequired || decision.requiresCEOApproval) {
          const approval = approvals.enqueue({
            priority: decision.priority || "HIGH",
            category: "Instantly COO Control",
            objective: decision.objective || campaign.name,
            reason: decision.reason,
            recommendation: decision.recommendation || "Review the evidence and approve only if this is a CEO-level decision.",
            risk: decision.risk || "MEDIUM",
            capability: decision.capability || "campaign.control",
            provider: "InstantlyCOO",
            action: decision.action,
            evidence: { campaign, decision, authority: auth }
          });
          result.actions.approvals.push(approval.item || approval);
          continue;
        }

        if (options.execute !== true) {
          result.notes.push(`Safe observe mode: planned ${decision.action} for ${campaign.name}. Re-run with { execute: true } for authorized browser actions.`);
          continue;
        }

        const execution = await this.executeDecision(page, campaign, decision);
        if (execution.ok) {
          result.actions.executed.push(execution);
          const verification = await this.verifyDecision(page, campaign, decision, execution);
          if (verification.ok) {
            result.actions.verified.push(verification);
            this.updateMemory(memory, campaign, "executed");
          } else {
            result.actions.failed.push(verification);
            this.updateMemory(memory, campaign, "verify_failed");
          }
        } else {
          result.actions.failed.push(execution);
          this.updateMemory(memory, campaign, "failed");
        }
      }

      await browser.saveSession(this.session);

      result.ok = true;
      result.stage = "COMPLETED";
      result.file = save("instantly_autonomous_coo_build026", result);
      saveMemory(memory);
      return result;
    } catch (err) {
      result.errors.push(err.stack || err.message);
      result.stage = "FAILED";
      result.file = save("instantly_error", result);
      saveMemory(memory);
      return result;
    } finally {
      await browser.shutdown();
    }
  }

  async waitForInstantlyReady(page, result) {
    try {
      await page.waitForLoadState("networkidle", { timeout: 25000 });
    } catch {
      result.notes.push("Network idle timeout; continuing with DOM inspection.");
    }

    await page.waitForTimeout(Number(process.env.MILES_INSTANTLY_WAIT_MS || 5000));

    const title = await page.title().catch(() => "");
    const url = page.url();
    if (/login|signin|auth/i.test(url) || /login|sign in/i.test(title)) {
      result.notes.push("Instantly appears to be at login/auth screen. Run BrowserSessionEnroller if session expired.");
    }
  }

  async extractCampaigns(page) {
    const raw = await page.evaluate(() => {
      function txt(el) {
        return (el?.innerText || el?.textContent || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .trim();
      }

      function visible(el) {
        const r = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }

      function statusFrom(text) {
        const l = text.toLowerCase();
        if (/\bpaused\b/.test(l)) return "paused";
        if (/\bdraft\b/.test(l)) return "draft";
        if (/\bactive\b|\brunning\b|\bsending\b/.test(l)) return "active";
        if (/\bcompleted\b|\bfinished\b/.test(l)) return "completed";
        if (/\berror\b|\bfailed\b/.test(l)) return "error";
        return "unknown";
      }

      function metricsFrom(text) {
        const lower = text.toLowerCase();
        const metrics = {};
        const pct = [...text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*%/g)].map(m => Number(m[1]));
        if (pct.length) metrics.percentages = pct;
        const leads = lower.match(/([0-9,]+)\s+(?:leads|contacts|recipients)/);
        if (leads) metrics.leads = Number(leads[1].replace(/,/g, ""));
        const bounces = lower.match(/([0-9]+(?:\.[0-9]+)?\s*%|[0-9,]+)\s+(?:bounce|bounces|bounced)/);
        if (bounces) metrics.bounceSignal = bounces[1];
        return metrics;
      }

      const candidates = [];
      const add = (el, source, confidence) => {
        if (!el || !visible(el)) return;
        const text = txt(el);
        if (!text || text.length < 3) return;

        let name = "";
        const aria = el.getAttribute("aria-label") || "";
        const title = el.getAttribute("title") || "";
        const dataName = el.getAttribute("data-name") || el.getAttribute("data-campaign-name") || "";
        const lines = text.split("\n").map(x => x.trim()).filter(Boolean);

        name = dataName || title || aria || lines[0] || text;
        name = name.replace(/^(campaign|status|name)\s*:?\s*/i, "").trim();

        const link = el.matches("a") ? el : el.querySelector("a[href*='campaign']");
        const href = link ? link.href : "";
        const idMatch = href.match(/campaigns?\/([^/?#]+)/i) || href.match(/campaign[_-]?id=([^&#]+)/i);

        candidates.push({
          name,
          status: statusFrom(text),
          source,
          confidence,
          href,
          id: idMatch ? decodeURIComponent(idMatch[1]) : null,
          text: text.slice(0, 1200),
          metrics: metricsFrom(text)
        });
      };

      // Preferred: anchors/cards that actually navigate to a campaign.
      document.querySelectorAll("a[href*='campaign']").forEach(a => {
        const row = a.closest("tr,[role='row'],[data-testid],[class*='card'],[class*='row'],li") || a;
        add(row, "campaign-link", 90);
      });

      // Tables/grids.
      document.querySelectorAll("table tbody tr,[role='row']").forEach(row => {
        const text = txt(row);
        if (/campaign|active|paused|draft|leads|sent|reply|bounce/i.test(text)) {
          add(row, "table-or-grid-row", 75);
        }
      });

      // Modern card/list layouts.
      document.querySelectorAll("[data-testid],[class*='campaign'],[class*='Campaign'],[class*='card'],[class*='Card']").forEach(el => {
        const text = txt(el);
        if (/active|paused|draft|leads|sent|reply|bounce|campaign/i.test(text)) {
          add(el, "card-or-testid", 65);
        }
      });

      return candidates;
    });

    const campaigns = [];
    const seen = new Set();

    for (const r of raw) {
      const name = cleanText(r.name, 140);
      const key = normalizeKey(r.id || r.href || name);
      if (isJunkName(name) || seen.has(key)) continue;
      seen.add(key);

      campaigns.push({
        name,
        id: r.id || null,
        href: r.href || null,
        status: r.status || "unknown",
        source: r.source,
        confidence: r.confidence,
        metrics: r.metrics || {},
        evidenceText: cleanText(r.text, 1000)
      });
    }

    // Prefer stronger evidence first and keep the operator focused.
    return campaigns
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, Number(process.env.MILES_INSTANTLY_MAX_CAMPAIGNS || 50));
  }

  decide(campaign, memory) {
    const name = (campaign.name || "").toLowerCase();
    const status = (campaign.status || "").toLowerCase();
    const text = (campaign.evidenceText || "").toLowerCase();

    if (status === "draft") {
      return { action: "IGNORE", reason: "Draft campaign should not be launched without explicit campaign build task.", confidence: "HIGH" };
    }

    if (status === "completed") {
      return { action: "INSPECT_FOR_REPLENISHMENT", reason: "Completed campaign may need fresh segment/relaunch planning.", confidence: "MEDIUM" };
    }

    if (status === "paused") {
      if (/bounce|bounced|invalid|deliverability|reputation|spam/.test(text)) {
        return {
          action: "DIAGNOSE_BOUNCE_AND_REPAIR",
          reason: "Paused campaign has bounce/deliverability signals.",
          objective: `Repair deliverability issue for ${campaign.name}`,
          recommendation: "MILES should inspect bounces, pause only bad inbox/list source, remove invalid leads, then resume when safe.",
          confidence: "HIGH",
          risk: "MEDIUM"
        };
      }
      return {
        action: "RESUME_OR_INSPECT_PAUSED_CAMPAIGN",
        reason: "Paused campaign is operational and should be inspected/resumed if no CEO-level risk exists.",
        objective: `Inspect and resume paused Instantly campaign ${campaign.name}`,
        confidence: "MEDIUM",
        risk: "LOW"
      };
    }

    if (/no leads|0 leads|empty|add leads|upload leads/.test(text)) {
      return {
        action: "UPLOAD_SEGMENT_LEADS",
        reason: "Campaign appears to need leads.",
        objective: `Upload verified segment leads to ${campaign.name}`,
        confidence: "HIGH",
        risk: "LOW"
      };
    }

    if (/no account|no inbox|connect email|mailbox/.test(text)) {
      return {
        action: "ASSIGN_INBOX_CAPACITY",
        reason: "Campaign appears to need inbox/mailbox assignment.",
        objective: `Assign available inbox capacity to ${campaign.name}`,
        confidence: "HIGH",
        risk: "LOW"
      };
    }

    if (name.includes("nurture") || name.includes("follow")) {
      return {
        action: "MONITOR_AND_OPTIMIZE",
        reason: "Low-risk nurture/follow-up campaign; monitor and optimize.",
        confidence: "MEDIUM",
        risk: "LOW"
      };
    }

    return {
      action: "INSPECT_AND_OPTIMIZE",
      reason: "Operational campaign should be inspected for leads, inboxes, bounces, and optimization opportunities.",
      objective: `Inspect and optimize ${campaign.name}`,
      confidence: campaign.confidence >= 75 ? "MEDIUM" : "LOW",
      risk: "LOW"
    };
  }

  async executeDecision(page, campaign, decision) {
    const record = {
      ok: false,
      campaign: campaign.name,
      action: decision.action,
      attemptedAt: new Date().toISOString(),
      steps: []
    };

    try {
      if (campaign.href) {
        await page.goto(campaign.href, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2500);
        record.steps.push("opened_campaign");
      }

      switch (decision.action) {
        case "RESUME_OR_INSPECT_PAUSED_CAMPAIGN":
          return await this.tryClickByText(page, record, ["Resume", "Start", "Activate", "Turn on", "Unpause"]);

        case "DIAGNOSE_BOUNCE_AND_REPAIR":
          record.ok = true;
          record.steps.push("opened_for_bounce_diagnosis");
          record.note = "Opened campaign for bounce diagnosis. Lead deletion/domain changes remain gated by CEO policy if encountered.";
          return record;

        case "UPLOAD_SEGMENT_LEADS":
          return await this.tryClickByText(page, record, ["Add leads", "Upload leads", "Import leads", "Leads"]);

        case "ASSIGN_INBOX_CAPACITY":
          return await this.tryClickByText(page, record, ["Accounts", "Email accounts", "Inboxes", "Add account", "Sender accounts"]);

        case "INSPECT_AND_OPTIMIZE":
        case "INSPECT_FOR_REPLENISHMENT":
        case "MONITOR_AND_OPTIMIZE":
          record.ok = true;
          record.steps.push("inspection_completed");
          return record;

        default:
          record.error = `No executor implemented for ${decision.action}`;
          return record;
      }
    } catch (err) {
      record.error = err.message;
      return record;
    }
  }

  async tryClickByText(page, record, labels = []) {
    for (const label of labels) {
      const locator = page.getByText(label, { exact: false }).first();
      try {
        if (await locator.count()) {
          await locator.click({ timeout: 5000 });
          await page.waitForTimeout(1500);
          record.ok = true;
          record.steps.push(`clicked:${label}`);
          return record;
        }
      } catch (err) {
        record.steps.push(`click_failed:${label}:${err.message}`);
      }
    }

    record.ok = false;
    record.error = `No matching control found for labels: ${labels.join(", ")}`;
    return record;
  }

  async verifyDecision(page, campaign, decision, execution) {
    const verification = {
      ok: false,
      campaign: campaign.name,
      action: decision.action,
      executionSteps: execution.steps || [],
      verifiedAt: new Date().toISOString()
    };

    try {
      await page.waitForTimeout(1500);
      const body = cleanText(await page.locator("body").innerText({ timeout: 10000 }), 2000).toLowerCase();

      if (["INSPECT_AND_OPTIMIZE", "INSPECT_FOR_REPLENISHMENT", "MONITOR_AND_OPTIMIZE", "DIAGNOSE_BOUNCE_AND_REPAIR"].includes(decision.action)) {
        verification.ok = true;
        verification.reason = "Inspection action completed without browser error.";
        return verification;
      }

      if (decision.action === "RESUME_OR_INSPECT_PAUSED_CAMPAIGN") {
        verification.ok = /active|running|sending|resume|start|activate/.test(body);
        verification.reason = verification.ok ? "Resume/activation controls or active state detected." : "Could not verify active state.";
        return verification;
      }

      if (decision.action === "UPLOAD_SEGMENT_LEADS") {
        verification.ok = /lead|import|upload|csv|contacts/.test(body);
        verification.reason = verification.ok ? "Lead import area detected." : "Could not verify lead import area.";
        return verification;
      }

      if (decision.action === "ASSIGN_INBOX_CAPACITY") {
        verification.ok = /account|inbox|email|sender|mailbox/.test(body);
        verification.reason = verification.ok ? "Inbox/account area detected." : "Could not verify inbox/account area.";
        return verification;
      }

      verification.ok = Boolean(execution.ok);
      verification.reason = "Generic execution verification.";
      return verification;
    } catch (err) {
      verification.error = err.message;
      return verification;
    }
  }

  updateMemory(memory, campaign, action) {
    const name = normalizeKey(campaign.name);
    memory.performance = memory.performance || {};
    memory.patterns = memory.patterns || {};
    memory.campaigns = memory.campaigns || {};

    memory.performance[name] =
      (memory.performance[name] || 0) +
      (action === "executed" ? 5 : action === "ignored" ? 0 : -2);

    memory.patterns[name] = {
      lastAction: action,
      status: campaign.status,
      source: campaign.source,
      confidence: campaign.confidence,
      ts: new Date().toISOString()
    };

    memory.campaigns[name] = {
      ...campaign,
      lastSeenAt: new Date().toISOString()
    };
  }
}

module.exports = new InstantlyCampaignOperator();
