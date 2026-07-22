"use strict";

class AuthorityEngine {

  evaluate(input = {}) {

    const objective =
      String(input.objective || "").toLowerCase();

    const action =
      String(input.action || "").toLowerCase();

    const provider =
      String(input.provider || "").toLowerCase();

    const readOnly =
      input.readOnly === true ||
      input.payload?.readOnly === true ||
      input.plan?.readOnly === true;

    const safeToAutoExecute =
      input.safeToAutoExecute === true ||
      input.payload?.safeToAutoExecute === true ||
      input.plan?.safeToAutoExecute === true;

    const requiresApproval =
      input.requiresApproval === true ||
      input.payload?.requiresApproval === true ||
      input.plan?.requiresApproval === true;

    // --------------------------------------------------------
    // Explicit governance always wins.
    // --------------------------------------------------------

    if (requiresApproval) {

      return {
        ok: false,
        authority: "CEO_APPROVAL_REQUIRED",
        approvalRequired: true,
        provider,
        reason: "Explicit approval requested."
      };

    }

    // --------------------------------------------------------
    // Read-only autonomous operations never require approval.
    // --------------------------------------------------------

    if (readOnly && safeToAutoExecute) {

      return {
        ok: true,
        authority: "MILES_OPERATIONAL",
        approvalRequired: false,
        provider,
        reason: "Authorized read-only operational task."
      };

    }

    // --------------------------------------------------------
    // CEO protected actions
    // --------------------------------------------------------

    const blockedPatterns = [

      "delete",
      "remove data",
      "drop table",

      "send proposal",

      "change pricing",

      "sign contract",

      "hire",

      "buy",
      "purchase",

      "dns",

      "publish website"

    ];

    const approvalRequired =
      blockedPatterns.some(pattern =>
        objective.includes(pattern) ||
        action.includes(pattern)
      );

    return {

      ok: !approvalRequired,

      authority:
        approvalRequired
          ? "CEO_APPROVAL_REQUIRED"
          : "MILES_OPERATIONAL",

      approvalRequired,

      provider,

      reason:
        approvalRequired
          ? "Action matches CEO approval governance rules."
          : "Action is within MILES operational authority."

    };

  }

}

module.exports = new AuthorityEngine();