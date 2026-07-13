"use strict";

/**
 * MILES Decision Learning Service
 * BUILD_038
 */

class DecisionLearningService {
    run(data) {
        const decisions = data.executive.decisions || [];
        const totals = { PROCEED: 0, ESCALATE: 0, DEFER: 0, UNKNOWN: 0 };
        const byPriority = {};
        const approvalRequired = [];

        for (const record of decisions) {
            const decision = record.decision?.decision || record.decision || "UNKNOWN";
            totals[decision] = (totals[decision] || 0) + 1;
            const priority = record.plan?.priority || record.priority || "UNKNOWN";
            byPriority[priority] = (byPriority[priority] || 0) + 1;
            if (record.decision?.approval?.approvalRequired || record.approvalRequired) approvalRequired.push(record);
        }

        const proceedRate = decisions.length ? Math.round(((totals.PROCEED || 0) / decisions.length) * 100) : 0;
        const escalationRate = decisions.length ? Math.round(((totals.ESCALATE || 0) / decisions.length) * 100) : 0;

        return {
            ok: true,
            action: "DECISION_LEARNING",
            generatedAt: new Date().toISOString(),
            sampleSize: decisions.length,
            totals,
            byPriority,
            proceedRate,
            escalationRate,
            approvalRequiredCount: approvalRequired.length,
            insight: this.insight(decisions.length, proceedRate, escalationRate)
        };
    }

    insight(size, proceedRate, escalationRate) {
        if (!size) return "No decision history available yet.";
        if (escalationRate > 35) return "High escalation rate; review governance rules and approval thresholds.";
        if (proceedRate > 80) return "Executive Brain is operating with high autonomy.";
        return "Decision pattern is stable; continue collecting history.";
    }
}

module.exports = new DecisionLearningService();
