"use strict";

class ExecutiveConversationService {
  static respond(input = {}) {
    const command = String(input.command || "").trim();
    const text = command.toLowerCase();
    const plan = input.plan || {};

    if (
      /what can you do|supported action|how can you help|your capabilities/.test(text)
    ) {
      return {
        ok: true,
        type: "EXECUTIVE_CONVERSATION",
        intent: plan.intent || "EXECUTIVE_STATUS",
        message: [
          "I am Miles, your Digital COO.",
          "",
          "My current operating priorities are:",
          "",
          "1. Executive conversation",
          "   I can explain what I can do, discuss priorities, clarify decisions, and translate your objectives into executable work.",
          "",
          "2. CEO approval",
          "   I can identify protected actions that require your authorization before execution.",
          "",
          "3. Core COO workflows",
          "   I can plan and coordinate outbound campaigns, revenue operations, proposal workflows, pipeline activity, business reviews, and connected-provider work.",
          "",
          "Examples:",
          "",
          '- "Review our Instantly campaigns and tell me what needs attention."',
          '- "Build the next-step plan for the Dreamers proposal."',
          '- "Show me what is waiting for CEO approval."',
          '- "Own outbound operations and increase booked meetings."',
          "",
          "I will answer executive questions directly. I will only create an operation when the request requires actual execution."
        ].join("\n")
      };
    }

    if (/who are you|what are you/.test(text)) {
      return {
        ok: true,
        type: "EXECUTIVE_CONVERSATION",
        intent: plan.intent || "EXECUTIVE_STATUS",
        message:
          "I am Miles, the Digital COO for Pathways 2 Government Contracting. My job is to help you decide, prioritize, authorize, execute, verify, and improve the company's operating work."
      };
    }

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)[.! ]*$/.test(text)) {
      return {
        ok: true,
        type: "EXECUTIVE_CONVERSATION",
        intent: plan.intent || "EXECUTIVE_STATUS",
        message:
          "Hello, Kevin. I am ready. Tell me the business outcome you want, the decision you need to make, or the work you want executed."
      };
    }

    return {
      ok: true,
      type: "EXECUTIVE_CONVERSATION",
      intent: plan.intent || "EXECUTIVE_STATUS",
      message: [
        "I understand the request as an executive question rather than an execution command.",
        "",
        `Request: ${command}`,
        "",
        "No operation was added to the execution queue."
      ].join("\n")
    };
  }
}

module.exports = ExecutiveConversationService;
