"use strict";

const fs = require("fs");
const path = require("path");

const marketingDiscovery = require("./MarketingDiscovery");
const orionDiscovery = require("./OrionDiscovery");
const captureCapacityRevenueDiscovery = require("./CaptureCapacityRevenueDiscovery");
const eventBus = require("../Events/EventBus");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const DISCOVERY_DIR = path.join(ROOT, "DATA", "discovery");
const DISCOVERY_LOG = path.join(DISCOVERY_DIR, "discovered_work.json");
const BROWSER_RESULTS_DIR = path.join(ROOT, "DATA", "browser", "operator_results");

function ensureDirs() {
  fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function latestJsonFile(dir, prefix) {
  try {
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .filter(f => !prefix || f.startsWith(prefix))
      .map(f => ({
        file: path.join(dir, f),
        time: fs.statSync(path.join(dir, f)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    return files[0]?.file || null;
  } catch {
    return null;
  }
}

function workItem({
  id,
  objective,
  provider,
  domain,
  priority = "MEDIUM",
  priorityScore = 50,
  reason,
  capability,
  metadata = {}
}) {
  return {
    id: id || `WORK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    objective,
    provider,
    domain,
    priority,
    priorityScore,
    reason,
    capability,
    metadata,
    discoveredAt: new Date().toISOString()
  };
}

class InstantlyOperationalDiscovery {
  async discover() {
    const work = [];

    const latest = latestJsonFile(BROWSER_RESULTS_DIR, "instantly_coo_mode_live");
    const lastResult = latest ? readJson(latest, null) : null;

    work.push(workItem({
      id: "INSTANTLY-RUN-COO-OPERATOR",
      objective: "Run Instantly COO operator to audit campaigns, inbox health, campaign readiness, and operational blockers.",
      provider: "Instantly",
      domain: "Revenue Operations",
      priority: "CRITICAL",
      priorityScore: 100,
      reason: "Instantly is a primary revenue system and must be inspected every COO cycle.",
      capability: "instantly.audit"
    }));

    if (!lastResult) {
      work.push(workItem({
        id: "INSTANTLY-NO-LAST-RESULT",
        objective: "Run first Instantly campaign discovery and create baseline campaign inventory.",
        provider: "Instantly",
        domain: "Revenue Operations",
        priority: "HIGH",
        priorityScore: 95,
        reason: "No prior Instantly operator result found.",
        capability: "instantly.baseline"
      }));

      return {
        ok: true,
        source: "InstantlyOperationalDiscovery",
        work
      };
    }

    const campaigns = lastResult.campaigns || [];
    const draftCampaigns = campaigns.filter(c => String(c.status).toLowerCase() === "draft");
    const pausedCampaigns = campaigns.filter(c => String(c.status).toLowerCase() === "paused");
    const activeCampaigns = campaigns.filter(c => String(c.status).toLowerCase() === "active");

    if (draftCampaigns.length > 0) {
      work.push(workItem({
        id: "INSTANTLY-DRAFT-READINESS",
        objective: `Inspect ${draftCampaigns.length} draft Instantly campaigns for missing leads, inboxes, sequences, schedules, and launch readiness.`,
        provider: "Instantly",
        domain: "Revenue Operations",
        priority: "HIGH",
        priorityScore: 90,
        reason: "Draft campaigns represent unused revenue capacity.",
        capability: "instantly.campaign_readiness",
        metadata: { count: draftCampaigns.length, campaigns: draftCampaigns.map(c => c.name).slice(0, 50) }
      }));
    }

    if (pausedCampaigns.length > 0) {
      work.push(workItem({
        id: "INSTANTLY-PAUSED-REPAIR",
        objective: `Inspect and repair ${pausedCampaigns.length} paused Instantly campaigns so sending can continue where safe.`,
        provider: "Instantly",
        domain: "Revenue Operations",
        priority: "CRITICAL",
        priorityScore: 98,
        reason: "Paused campaigns stop revenue generation and should be diagnosed automatically.",
        capability: "instantly.pause_repair",
        metadata: { count: pausedCampaigns.length, campaigns: pausedCampaigns.map(c => c.name).slice(0, 50) }
      }));
    }

    if (activeCampaigns.length > 0) {
      work.push(workItem({
        id: "INSTANTLY-ACTIVE-HEALTH",
        objective: `Audit ${activeCampaigns.length} active Instantly campaigns for bounce risk, reply performance, lead exhaustion, and inbox capacity.`,
        provider: "Instantly",
        domain: "Revenue Operations",
        priority: "HIGH",
        priorityScore: 85,
        reason: "Active campaigns require continuous COO monitoring.",
        capability: "instantly.active_health",
        metadata: { count: activeCampaigns.length, campaigns: activeCampaigns.map(c => c.name).slice(0, 50) }
      }));
    }

    return {
      ok: true,
      source: "InstantlyOperationalDiscovery",
      work
    };
  }
}

class WebsiteGrowthDiscovery {
  async discover() {
    return {
      ok: true,
      source: "WebsiteGrowthDiscovery",
      work: [
        workItem({
          id: "WEBSITE-B12-CONVERSION-AUDIT",
          objective: "Audit B12 website for lead-generation improvements, homepage CTA strength, service page clarity, forms, SEO, and conversion blockers.",
          provider: "B12",
          domain: "Marketing Operations",
          priority: "HIGH",
          priorityScore: 82,
          reason: "Website must operate as a lead-generation system, not a static brochure.",
          capability: "website.conversion_audit"
        })
      ]
    };
  }
}

class LinkedInGrowthDiscovery {
  async discover() {
    return {
      ok: true,
      source: "LinkedInGrowthDiscovery",
      work: [
        workItem({
          id: "LINKEDIN-DAILY-GROWTH-WORK",
          objective: "Prepare LinkedIn post ideas, article topics, connection targets, and outreach messages for GovCon prospects.",
          provider: "LinkedIn",
          domain: "Marketing Operations",
          priority: "MEDIUM",
          priorityScore: 72,
          reason: "LinkedIn supports relationship building and inbound authority.",
          capability: "linkedin.growth_queue"
        })
      ]
    };
  }
}

class GovernmentDataDiscovery {
  async discover() {
    return {
      ok: true,
      source: "GovernmentDataDiscovery",
      work: [
        workItem({
          id: "GOVDATA-REFRESH-CHECK",
          objective: "Check government data refresh status for USAspending, GSA eLibrary, VA FSS, SAM, forecasts, RFIs, sources sought, and other scheduled pulls.",
          provider: "GovernmentData",
          domain: "Intelligence Operations",
          priority: "HIGH",
          priorityScore: 88,
          reason: "ORION must stay current with awards, contractors, vehicles, and new procurement activity.",
          capability: "government_data.refresh_check"
        })
      ]
    };
  }
}

class DiscoveryEngine {
  constructor() {
    this.sources = [
      new InstantlyOperationalDiscovery(),
      marketingDiscovery,
      orionDiscovery,
      captureCapacityRevenueDiscovery,
      new WebsiteGrowthDiscovery(),
      new LinkedInGrowthDiscovery(),
      new GovernmentDataDiscovery()
    ];

    ensureDirs();

    if (!fs.existsSync(DISCOVERY_LOG)) {
      fs.writeFileSync(DISCOVERY_LOG, JSON.stringify([], null, 2));
    }
  }

  async discoverAll() {
    ensureDirs();

    const startedAt = new Date().toISOString();

    eventBus.publish("discovery.started", {
      sourceCount: this.sources.length,
      startedAt
    }, {
      source: "DiscoveryEngine"
    });

    const results = [];
    const discoveredWork = [];

    for (const source of this.sources) {
      try {
        const result = await source.discover();
        results.push(result);

        for (const item of result.work || []) {
          discoveredWork.push(item);
        }
      } catch (err) {
        results.push({
          ok: false,
          source: source.constructor.name,
          error: err.stack || err.message,
          work: []
        });
      }
    }

    const deduped = this.dedupe(discoveredWork);

    deduped.sort((a, b) => {
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    });

    this.save(deduped);

    eventBus.publish("discovery.completed", {
      discoveredCount: deduped.length,
      results,
      work: deduped,
      completedAt: new Date().toISOString()
    }, {
      source: "DiscoveryEngine"
    });

    return {
      ok: true,
      type: "DISCOVERY_RESULT",
      discoveredCount: deduped.length,
      work: deduped,
      results,
      startedAt,
      completedAt: new Date().toISOString()
    };
  }

  dedupe(work) {
    const seen = new Set();
    const out = [];

    for (const item of work || []) {
      const key = String(item.id || item.objective || "").toLowerCase();

      if (!key || seen.has(key)) continue;

      seen.add(key);
      out.push(item);
    }

    return out;
  }

  save(work) {
    fs.writeFileSync(DISCOVERY_LOG, JSON.stringify(work, null, 2));
  }

  recent() {
    ensureDirs();

    if (!fs.existsSync(DISCOVERY_LOG)) {
      return [];
    }

    return JSON.parse(fs.readFileSync(DISCOVERY_LOG, "utf8"));
  }

  status() {
    return {
      ok: true,
      sources: this.sources.map(s => s.constructor.name),
      recentWorkCount: this.recent().length,
      log: DISCOVERY_LOG
    };
  }
}

module.exports = new DiscoveryEngine();