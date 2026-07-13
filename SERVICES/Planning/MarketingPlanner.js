const BasePlanner = require("./BasePlanner");

class MarketingPlanner extends BasePlanner {
  constructor() {
    super({
      domain: "marketing",
      workforce: "Marketing Workforce",
      priority: "HIGH"
    });
  }

  matches(objective = "") {
    const text = String(objective).toLowerCase();
    return /instantly|campaign|email|bounce|deliverability|lead list|outbound|warmup|marketing/.test(text);
  }

  createPlan(objective, context = {}) {
    const requiredCapabilities = [
      "marketing.instantly.read",
      "marketing.campaign.audit",
      "marketing.deliverability.evaluate",
      "marketing.execution.route",
      "executive.update.generate"
    ];

    const steps = [
      this.createStep(1, "marketing.instantly.read", {
        department: "Marketing",
        provider: "MarketingProvider",
        action: "readCampaigns",
        expectedOutput: "Current Instantly campaign inventory with campaign status and metrics.",
        verification: "Verify campaign status, campaign count, active count, paused count, and available metrics are captured."
      }),
      this.createStep(2, "marketing.campaign.audit", {
        department: "Marketing",
        action: "identifyPausedCampaigns",
        expectedOutput: "List of paused campaigns requiring review.",
        verification: "Verify paused campaigns are separated from active campaigns."
      }),
      this.createStep(3, "marketing.deliverability.evaluate", {
        department: "Marketing",
        action: "evaluateDeliverabilityRisk",
        expectedOutput: "Deliverability risk assessment for paused campaigns.",
        verification: "Verify bounce risk, warmup status, sending domain safety, and recent campaign health are considered."
      }),
      this.createStep(4, "marketing.execution.route", {
        department: "Marketing",
        action: "recommendResumeOrHold",
        expectedOutput: "Resume, hold, or CEO-review recommendation for each paused campaign.",
        verification: "Verify recommendations follow P2GC sending safety and CEO authority rules."
      }),
      this.createStep(5, "executive.update.generate", {
        department: "Executive",
        action: "generateExecutiveUpdate",
        expectedOutput: "Executive update summarizing campaign status and recommended action.",
        verification: "Verify update is clear, concise, and action-oriented."
      })
    ];

    return {
      matched: true,
      domain: this.domain,
      workforce: this.workforce,
      requiredCapabilities,
      steps,
      executionAuthority: "OPERATIONAL_WITH_LIMITS",
      approvalRequired: false,
      providers: ["MarketingProvider"],
      verificationChecklist: [
        "Instantly campaign data was read successfully.",
        "Paused campaigns were identified.",
        "Deliverability risk was evaluated.",
        "Resume or hold recommendation was generated.",
        "Executive update was produced."
      ],
      successCriteria: [
        "Paused campaign inventory exists.",
        "Every paused campaign has an action recommendation.",
        "No unsafe sending action is performed without approval."
      ],
      context
    };
  }
}

module.exports = new MarketingPlanner();