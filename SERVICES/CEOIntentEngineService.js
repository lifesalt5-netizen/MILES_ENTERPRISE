"use strict";

class CEOIntentEngineService {
  static classify(input = {}) {
    const command = String(input.command || "").trim();
    const text = command.toLowerCase();

    if (!command) {
      return {
        ok: false,
        route: "INVALID",
        intent: "EMPTY_COMMAND",
        confidence: 1,
        reason: "No command was provided."
      };
    }

    const explicitExecutionPatterns = [
      /^\s*(create|build|run|launch|send|update|change|fix|implement|execute|start|stop|delete|remove|add|connect|upload|export|generate|schedule|install|deploy|restart|open|close)\b/i,
      /^\s*(check|audit|review|analyze|inspect|verify|test|research|find|identify|prepare|produce|write|draft)\b/i,
      /\b(set up|log in|sign in|take over|own this|manage this|complete this|finish this|do this)\b/i,
      /\b(add this to the queue|create an operation|assign this|execute this|make this happen)\b/i
    ];

    const isExplicitExecution = explicitExecutionPatterns.some((pattern) =>
      pattern.test(command)
    );

    if (isExplicitExecution) {
      return {
        ok: true,
        route: "EXECUTION",
        intent: "EXECUTE_BUSINESS_WORK",
        confidence: 0.96,
        reason: "The request contains an explicit execution instruction."
      };
    }

    const conversationPatterns = [
      /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i,
      /\bwho are you\b/i,
      /\bwhat are you\b/i,
      /\bwhat can you do\b/i,
      /\bhow can you help\b/i,
      /\bwhat do you think\b/i,
      /\bshould we\b/i,
      /\bshould i\b/i,
      /\bwhat should\b/i,
      /\bwhy\b/i,
      /\bhow does\b/i,
      /\bhow do\b/i,
      /\bexplain\b/i,
      /\btell me about\b/i,
      /\bcompare\b/i,
      /\bwhich is better\b/i,
      /\bwhat is the status\b/i,
      /\bstatus update\b/i,
      /\bwhat is our priority\b/i,
      /\bwhat should our priority\b/i,
      /\bstrategy\b/i,
      /\bbrainstorm\b/i
    ];

    const isConversation =
      command.endsWith("?") ||
      conversationPatterns.some((pattern) => pattern.test(command));

    if (isConversation) {
      return {
        ok: true,
        route: "CONVERSATION",
        intent: "EXECUTIVE_CONVERSATION",
        confidence: 0.93,
        reason: "The request is an executive question or discussion."
      };
    }

    return {
      ok: true,
      route: "EXECUTION",
      intent: "EXECUTE_BUSINESS_WORK",
      confidence: 0.75,
      reason: "A non-question business instruction defaults to execution."
    };
  }
}

module.exports = CEOIntentEngineService;
