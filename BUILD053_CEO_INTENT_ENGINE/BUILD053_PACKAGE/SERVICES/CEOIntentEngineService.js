"use strict";

/*
  MILES ENTERPRISE
  BUILD 053 - CEO Intent Engine

  Purpose:
    Interpret what the CEO is trying to accomplish before the operational
    planner creates a governed execution plan.
*/

class CEOIntentEngineService {
  static analyze(input = {}) {
    const command = String(input.command || "").trim();
    const text = command.toLowerCase();

    const result = {
      ok: Boolean(command),
      command,
      intent: "EXECUTION_REQUEST",
      route: "EXECUTION",
      confidence: 0.7,
      requiresPlanner: true,
      requiresApprovalReview: false,
      shouldQueue: true,
      rationale: "The instruction appears to request operational work."
    };

    if (!command) {
      return {
        ...result,
        ok: false,
        intent: "EMPTY",
        route: "REJECT",
        confidence: 1,
        requiresPlanner: false,
        shouldQueue: false,
        rationale: "No instruction was provided."
      };
    }

    if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)[.! ]*$/.test(text)) {
      return {
        ...result,
        intent: "CONVERSATION",
        route: "DIRECT_RESPONSE",
        confidence: 0.99,
        requiresPlanner: false,
        shouldQueue: false,
        rationale: "The message is conversational and does not request work."
      };
    }

    if (/what can you do|who are you|what are you|how can you help|your capabilities|supported action/.test(text)) {
      return {
        ...result,
        intent: "EXECUTIVE_STATUS",
        route: "DIRECT_RESPONSE",
        confidence: 0.99,
        requiresPlanner: false,
        shouldQueue: false,
        rationale: "The CEO is asking about Miles or its capabilities."
      };
    }

    if (/what.*waiting.*approval|show.*approval|pending approval|approval queue|what needs my approval/.test(text)) {
      return {
        ...result,
        intent: "APPROVAL_STATUS",
        route: "DIRECT_RESPONSE",
        confidence: 0.97,
        requiresPlanner: false,
        shouldQueue: false,
        rationale: "The CEO is asking for the current approval state."
      };
    }

    if (/^(what|why|how|who|when|where|which|can|could|would|should|are|is|do|does|did|tell me|explain)\b/.test(text) || text.endsWith("?")) {
      const strategic = /revenue|sales|profit|growth|goal|target|strategy|priority|priorities|fastest|best path|10k|ten thousand|commercialize|scale/.test(text);
      const analytical = /analy[sz]e|compare|evaluate|assess|review|diagnose|root cause|risk|recommend/.test(text);

      if (strategic) {
        return {
          ...result,
          intent: "STRATEGIC_GOAL",
          route: "EXECUTIVE_ADVISORY",
          confidence: 0.93,
          requiresPlanner: false,
          shouldQueue: false,
          rationale: "The CEO is asking for strategic guidance rather than immediate execution."
        };
      }

      if (analytical) {
        return {
          ...result,
          intent: "ANALYSIS_REQUEST",
          route: "EXECUTIVE_ADVISORY",
          confidence: 0.91,
          requiresPlanner: false,
          shouldQueue: false,
          rationale: "The CEO is requesting analysis or a recommendation."
        };
      }

      return {
        ...result,
        intent: "INFORMATION_REQUEST",
        route: "DIRECT_RESPONSE",
        confidence: 0.9,
        requiresPlanner: false,
        shouldQueue: false,
        rationale: "The CEO is asking a direct question."
      };
    }

    if (/^(decide|choose|recommend|tell me whether|should we|which option)/.test(text)) {
      return {
        ...result,
        intent: "DECISION_REQUEST",
        route: "EXECUTIVE_ADVISORY",
        confidence: 0.92,
        requiresPlanner: false,
        shouldQueue: false,
        rationale: "The CEO is requesting decision support."
      };
    }

    if (/^(build|create|implement|execute|run|start|launch|send|submit|delete|change|update|fix|repair|deploy|connect|configure|set up|setup|own|manage|operate|take over|complete|finish|do)\b/.test(text)) {
      return {
        ...result,
        intent: "DELEGATION",
        route: "EXECUTION",
        confidence: 0.96,
        requiresPlanner: true,
        requiresApprovalReview: true,
        shouldQueue: true,
        rationale: "The CEO is delegating work for Miles to plan and execute."
      };
    }

    if (/goal|target|objective|need us to|i want us to|we need to|get us to|make sure we/.test(text)) {
      return {
        ...result,
        intent: "STRATEGIC_DIRECTIVE",
        route: "EXECUTION",
        confidence: 0.86,
        requiresPlanner: true,
        requiresApprovalReview: true,
        shouldQueue: true,
        rationale: "The CEO stated a business objective as a directive that should become planned work."
      };
    }

    return result;
  }
}

module.exports = CEOIntentEngineService;
