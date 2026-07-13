"use strict";

class ExecutionPlanService {
  create(input = {}) {
    const decision = input.decision || {};
    const providerResult = input.providerResult || {};
    const payload = input.payload || {};

    const approvalRequired =
      decision?.approval?.approvalRequired === true ||
      decision?.decision === "ESCALATE";

    return {
      ok: !approvalRequired,
      type: "AUTONOMOUS_EXECUTION_PLAN",
      decision: decision.decision || "UNKNOWN",
      executionMode: approvalRequired ? "CEO_APPROVAL_REQUIRED" : "AUTONOMOUS",
      provider: payload.provider || providerResult.provider || null,
      action: payload.action || providerResult.action || null,
      capability: payload.capability || providerResult.capability || null,
      workPackageId: payload.workPackageId || providerResult.workPackageId || null,
      taskId: input.taskId || providerResult.taskId || null,
      objective: payload.objective || providerResult.objective || null,
      canExecute: !approvalRequired,
      verificationRequired: true,
      reportToExecutive: true,
      nextActions: this.nextActions(decision, providerResult, payload),
      approval: decision.approval || null,
      risk: decision.risk || null,
      confidence: decision.confidence || null,
      createdAt: new Date().toISOString()
    };
  }

  nextActions(decision = {}, providerResult = {}, payload = {}) {
    if (decision.decision === "ESCALATE") {
      return [
        "Hold autonomous execution.",
        "Route to Kevin for CEO approval.",
        "Include authority, risk, confidence, and provider evidence."
      ];
    }

    const provider = payload.provider || providerResult.provider || "Provider";

    return [
      `Accept ${provider} execution result.`,
      "Verify result evidence.",
      "Update Executive State.",
      "Generate executive reporting entry."
    ];
  }
}

module.exports = new ExecutionPlanService();