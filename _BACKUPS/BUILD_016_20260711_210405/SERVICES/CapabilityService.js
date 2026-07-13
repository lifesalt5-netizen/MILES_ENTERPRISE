const workforce = require("./WorkforceService");
const executiveState = require("./ExecutiveStateService");
const plannerRegistry = require("./Planning/PlannerRegistry");

class CapabilityService {
  buildGraph() {
    const graph = workforce.capabilityGraph();

    executiveState.update("capabilities", {
      count: Object.keys(graph).length,
      graph
    });

    executiveState.update("workforce", workforce.status());

    return {
      ok: true,
      capabilities: Object.keys(graph).length,
      graph
    };
  }

  findWorkers(capability) {
    const graph = this.buildGraph().graph;
    const q = String(capability || "").toLowerCase();

    return Object.entries(graph)
      .filter(([cap]) => {
        const normalizedCap = String(cap || "").toLowerCase();
        return normalizedCap.includes(q) || q.includes(normalizedCap);
      })
      .map(([capability, employees]) => ({ capability, employees }));
  }

  findBestWorker(capability) {
    const matches = this.findWorkers(capability);
    const first = matches?.[0]?.employees?.[0] || null;

    if (!first) {
      return {
        employee: "MILES",
        department: "Executive",
        source: "fallback"
      };
    }

    return {
      employee: first.employee || first.name || first.id || "MILES",
      department: first.department || "Executive",
      source: "workforce"
    };
  }

  planObjective(objective, context = {}) {
    const operationalPlan = plannerRegistry.createOperationalPlan(objective, context);
    const requiredCapabilities = operationalPlan.requiredCapabilities || [];

    const assignments = requiredCapabilities.map(capability => ({
      capability,
      candidates: this.findWorkers(capability),
      bestWorker: this.findBestWorker(capability)
    }));

    return {
      ok: true,
      objective,
      domain: operationalPlan.domain,
      workforce: operationalPlan.workforce,
      requiredCapabilities,
      assignments,
      operationalPlan
    };
  }

  registryStatus() {
    return {
      ok: true,
      planners: plannerRegistry.list()
    };
  }
}

module.exports = new CapabilityService();