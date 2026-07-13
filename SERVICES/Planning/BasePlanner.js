class BasePlanner {
  constructor(config = {}) {
    this.domain = config.domain || "executive";
    this.workforce = config.workforce || "Executive Workforce";
    this.priority = config.priority || "MEDIUM";
  }

  matches() {
    return false;
  }

  createStep(index, capability, options = {}) {
    return {
      step: index,
      capability,
      assignedTo: options.assignedTo || "MILES",
      department: options.department || this.workforce,
      status: "QUEUED",
      dependsOn: options.dependsOn || [],
      taskType: options.taskType || "WORKFORCE_STEP",
      provider: options.provider || null,
      action: options.action || `Execute ${capability}`,
      expectedOutput: options.expectedOutput || `${capability} output`,
      verification: options.verification || `Verify ${capability} produced actionable output.`
    };
  }

  createPlan(objective, context = {}) {
    return {
      matched: false,
      domain: this.domain,
      workforce: this.workforce,
      requiredCapabilities: [],
      steps: [],
      executionAuthority: "OPERATIONAL",
      approvalRequired: false,
      providers: [],
      verificationChecklist: [],
      successCriteria: [],
      context
    };
  }
}

module.exports = BasePlanner;