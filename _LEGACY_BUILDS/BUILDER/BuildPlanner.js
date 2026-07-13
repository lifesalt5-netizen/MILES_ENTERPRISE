const analyzer = require("./ProjectAnalyzer");

class BuildPlanner {
  run() {
    const { result } = analyzer.writeReport();

    const plan = [];

    if (result.warnings.some(w => w.toLowerCase().includes("logger"))) {
      plan.push({
        priority: 1,
        task: "Resolve duplicate Logger/logger modules",
        type: "TECH_DEBT",
        risk: "HIGH"
      });
    }

    if (result.emptyFiles.length) {
      plan.push({
        priority: 2,
        task: `Review ${result.emptyFiles.length} empty files`,
        type: "CLEANUP",
        risk: "MEDIUM"
      });
    }

    if (result.missingConnectors.length) {
      plan.push({
        priority: 3,
        task: "Build missing connector wrappers",
        type: "CONNECTORS",
        risk: "HIGH",
        connectors: result.missingConnectors
      });
    }

    plan.push({
      priority: 4,
      task: "Implement ORION connector",
      type: "BUSINESS_AUTOMATION",
      risk: "HIGH"
    });

    return {
      ok: true,
      action: "BUILD_PLAN",
      generatedAt: new Date().toISOString(),
      repositoryHealth: Math.max(50, 100 - result.warnings.length * 5 - result.emptyFiles.length),
      plan
    };
  }
}

module.exports = new BuildPlanner();