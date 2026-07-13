"use strict";

class EscalationManagerService {
    evaluate(item = {}) {
        const reasons = [];
        if (item.requiresKevin === true) reasons.push("Work item requires Kevin approval.");
        if (item.executionType === "APPROVAL_REQUIRED") reasons.push("Execution type requires approval.");
        if (/pricing|contract|legal|hire|fire|agreement|delete|destructive/i.test([item.title, item.description, item.recommendedAction].join(" "))) {
            reasons.push("Governance keyword detected.");
        }
        return {
            ok: true,
            action: "ESCALATION_EVALUATION",
            escalated: reasons.length > 0,
            reasons,
            recommendedStatus: reasons.length ? "AWAITING_CEO_APPROVAL" : "AUTHORIZED"
        };
    }
}

module.exports = new EscalationManagerService();
