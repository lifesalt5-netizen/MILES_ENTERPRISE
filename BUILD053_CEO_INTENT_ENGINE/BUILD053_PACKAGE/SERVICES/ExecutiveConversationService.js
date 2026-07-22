"use strict";

class ExecutiveConversationService {
  static async respond(input = {}) {
    const command = String(input.command || "").trim();
    const text = command.toLowerCase();
    const plan = input.plan || {};
    const ceoIntent = input.ceoIntent || {};
    const pendingApprovals = Number(input.pendingApprovals || 0);
    const executiveResponses = input.executiveResponses || null;

    const context = {
      command,
      plan,
      ceoIntent,
      pendingApprovals,
      generatedAt: new Date().toISOString()
    };

    const candidateMethods = [
      "answer",
      "respond",
      "converse",
      "handleConversation",
      "generateResponse"
    ];

    for (const method of candidateMethods) {
      if (executiveResponses && typeof executiveResponses[method] === "function") {
        try {
          const result = await executiveResponses[method](command, context);

          if (typeof result === "string" && result.trim()) {
            return this.wrap(result.trim(), ceoIntent, plan);
          }

          if (result && typeof result.message === "string" && result.message.trim()) {
            return this.wrap(result.message.trim(), ceoIntent, plan);
          }

          if (result && typeof result.response === "string" && result.response.trim()) {
            return this.wrap(result.response.trim(), ceoIntent, plan);
          }
        } catch {
          // Fall through to deterministic executive responses.
        }
      }
    }

    if (/what can you do|supported action|how can you help|your capabilities/.test(text)) {
      return this.wrap([
        "I am Miles, your Digital COO.",
        "",
        "I can answer executive questions, identify priorities, support decisions, translate goals into governed work, coordinate COO workflows, and track protected actions requiring your approval.",
        "",
        "Current operating areas include outbound and Instantly, revenue operations, proposals, pipeline activity, ORION intelligence, provider coordination, business reviews, and execution monitoring.",
        "",
        `Pending CEO approvals: ${pendingApprovals}.`,
        "",
        "Questions receive direct answers. Delegated work becomes a planned operation. External, financial, legal, submission, deletion, and launch actions remain protected until approved."
      ].join("\n"), ceoIntent, plan);
    }

    if (/who are you|what are you/.test(text)) {
      return this.wrap(
        "I am Miles, the Digital COO for Pathways 2 Government Contracting. My role is to help you decide, prioritize, authorize, execute, verify, and improve the company's operating work.",
        ceoIntent,
        plan
      );
    }

    if (/what.*waiting.*approval|show.*approval|pending approval|approval queue|what needs my approval|approval/.test(text)) {
      return this.wrap(
        `You currently have ${pendingApprovals} item(s) waiting for CEO approval. Open the Approval Center to review, approve, deny, or modify them.`,
        ceoIntent,
        plan
      );
    }

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)[.! ]*$/.test(text)) {
      return this.wrap(
        "Hello, Kevin. I am ready. Tell me the business outcome you want, the decision you need to make, or the work you want executed.",
        ceoIntent,
        plan
      );
    }

    if (ceoIntent.intent === "STRATEGIC_GOAL" || ceoIntent.intent === "DECISION_REQUEST") {
      return this.wrap([
        "I understand this as an executive strategy or decision request, not an instruction to execute yet.",
        "",
        `Objective: ${command}`,
        "",
        "I will keep this out of the operations queue until you turn the recommendation into a directive."
      ].join("\n"), ceoIntent, plan);
    }

    if (ceoIntent.intent === "ANALYSIS_REQUEST") {
      return this.wrap([
        "I understand this as an analysis request.",
        "",
        `Request: ${command}`,
        "",
        "No execution operation was created."
      ].join("\n"), ceoIntent, plan);
    }

    return this.wrap([
      "I understand the request as an executive question rather than an execution command.",
      "",
      `Request: ${command}`,
      "",
      "No operation was added to the execution queue."
    ].join("\n"), ceoIntent, plan);
  }

  static wrap(message, ceoIntent = {}, plan = {}) {
    return {
      ok: true,
      type: "EXECUTIVE_CONVERSATION",
      intent: ceoIntent.intent || plan.intent || "EXECUTIVE_STATUS",
      route: ceoIntent.route || "DIRECT_RESPONSE",
      message
    };
  }
}

module.exports = ExecutiveConversationService;
