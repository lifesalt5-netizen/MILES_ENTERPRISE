"use strict";

const providerRouter = require("../ProviderRouterService");

class OrionDiscovery {
  async discover() {
    const task = {
      id: `DISCOVERY-ORION-${Date.now()}`,
      payload: {
        provider: "OrionProvider",
        action: "refresh",
        capability: "orion.sqlite.read",
        objective: "Discover ORION operational work",
        assignedTo: "MILES",
        department: "ORION"
      }
    };

    const result = await providerRouter.executeProviderTask(task);
    const work = [];

    if (!result.ok || result.status !== "Healthy") {
      work.push({
        id: `WORK-ORION-HEALTH-${Date.now()}`,
        source: "OrionDiscovery",
        provider: "OrionProvider",
        domain: "orion",
        priority: "CRITICAL",
        priorityScore: 100,
        objective: "Investigate ORION database health",
        reason: "ORION provider reported unhealthy status.",
        discoveredAt: new Date().toISOString()
      });
    }

    if ((result.metrics?.opportunities || 0) === 0) {
      work.push({
        id: `WORK-ORION-OPPS-${Date.now()}`,
        source: "OrionDiscovery",
        provider: "OrionProvider",
        domain: "orion",
        priority: "HIGH",
        priorityScore: 85,
        objective: "Verify ORION opportunity ingestion",
        reason: "No ORION opportunities detected.",
        discoveredAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      source: "OrionDiscovery",
      providerStatus: result.status,
      work
    };
  }
}

module.exports = new OrionDiscovery();