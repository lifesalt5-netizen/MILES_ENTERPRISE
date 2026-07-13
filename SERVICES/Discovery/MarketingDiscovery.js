"use strict";

const providerRouter = require("../ProviderRouterService");

class MarketingDiscovery {
  async discover() {
    const task = {
      id: `DISCOVERY-MARKETING-${Date.now()}`,
      payload: {
        provider: "MarketingProvider",
        action: "refresh",
        capability: "marketing.instantly.read",
        objective: "Discover Instantly marketing work",
        assignedTo: "MILES",
        department: "Marketing"
      }
    };

    const result = await providerRouter.executeProviderTask(task);
    const work = [];

    const paused = result.metrics?.pausedCampaigns || 0;
    const active = result.metrics?.activeCampaigns || 0;

    if (paused > 0) {
      work.push({
        id: `WORK-MARKETING-PAUSED-${Date.now()}`,
        source: "MarketingDiscovery",
        provider: "MarketingProvider",
        domain: "marketing",
        priority: "HIGH",
        priorityScore: 90,
        objective: "Review paused Instantly campaigns",
        reason: `${paused} paused Instantly campaign(s) detected.`,
        discoveredAt: new Date().toISOString()
      });
    }

    if (active === 0) {
      work.push({
        id: `WORK-MARKETING-NO-ACTIVE-${Date.now()}`,
        source: "MarketingDiscovery",
        provider: "MarketingProvider",
        domain: "marketing",
        priority: "CRITICAL",
        priorityScore: 100,
        objective: "Investigate why all Instantly campaigns are paused",
        reason: "No active Instantly campaigns detected.",
        discoveredAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      source: "MarketingDiscovery",
      providerStatus: result.status,
      work
    };
  }
}

module.exports = new MarketingDiscovery();