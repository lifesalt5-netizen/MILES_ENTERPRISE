const BasePlanner = require("./BasePlanner");

class ExecutivePlanner extends BasePlanner {
  constructor() {
    super({
      domain: "executive",
      workforce: "Executive Operations Workforce",
      priority: "MEDIUM"
    });
  }

  matches() {
    return true;
  }

  createPlan(objective, context = {}) {
    const requiredCapabilities = [
      "executive.objective.evaluate",
      "executive.priority.route",
      "executive.update.generate"
    ];

    const steps = [
      this.createStep(1, "executive.objective.evaluate", {
        department: "Executive",
        action: "evaluateObjective",
        expectedOutput: "Clear interpretation of the work objective.",
        verification: "Verify the objective is actionable and aligned to P2GC operating priorities."
      }),
      this.createStep(2, "executive.priority.route", {
        department: "Executive",
        action: "routeObjective",
        expectedOutput: "Recommended department, priority, and execution path.",
        verification: "Verify the work is assigned to the right workforce or flagged for CEO review."
      }),
      this.createStep(3, "executive.update.generate", {
        department: "Executive",
        action: "generateExecutiveUpdate",
        expectedOutput: "Executive update for the planned work.",
        verification: "Verify update contains status, owner, and next action."
      })
    ];

    return {
      matched: true,
      domain: this.domain,
      workforce: this.workforce,
      requiredCapabilities,
      steps,
      executionAuthority: "OPERATIONAL",
      approvalRequired: this.requiresApproval(objective),
      providers: [],
      verificationChecklist: [
        "Objective was interpreted.",
        "Priority was assigned.",
        "Execution path was created.",
        "Executive update was generated."
      ],
      successCriteria: [
        "Work item is no longer ambiguous.",
        "MILES has a routed next action."
      ],
      context
    };
  }

  requiresApproval(objective = "") {
    const text = String(objective).toLowerCase();
    return /price|pricing|send proposal|proposal send|legal|contract|spend|buy|dns|publish|delete|hire/.test(text);
  }
}

module.exports = new ExecutivePlanner();