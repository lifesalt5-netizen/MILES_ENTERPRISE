"use strict";

/**
 * MILES Confidence Scoring Service
 * BUILD_038
 */

class ConfidenceScoringService {
    run({ decisionLearning, failureLearning, routingLearning, priorityLearning }) {
        let score = 70;
        const reasons = [];

        if ((decisionLearning.sampleSize || 0) >= 10) { score += 8; reasons.push("Decision history sample is meaningful."); }
        if ((decisionLearning.proceedRate || 0) >= 70) { score += 6; reasons.push("Executive autonomy rate is strong."); }
        if ((decisionLearning.escalationRate || 0) > 35) { score -= 8; reasons.push("Escalation rate is elevated."); }
        if ((failureLearning.failedWorkItems || 0) > 10) { score -= 8; reasons.push("Failed work item count is elevated."); }
        if ((failureLearning.blockedWorkItems || 0) > 0) { score -= 5; reasons.push("Blocked work exists."); }
        if ((failureLearning.runtimeFailures || []).length > 0) { score -= 12; reasons.push("Runtime failures detected."); }
        if ((routingLearning.routeRate || 0) >= 70) { score += 7; reasons.push("Routing rate is healthy."); }
        if ((routingLearning.skipRate || 0) > 20) { score -= 7; reasons.push("Routing skip rate is elevated."); }
        if ((priorityLearning.urgentOpenWork || 0) > 5) { score -= 5; reasons.push("Urgent open work is accumulating."); }

        score = Math.max(0, Math.min(100, score));

        return {
            ok: true,
            action: "CONFIDENCE_SCORING",
            generatedAt: new Date().toISOString(),
            score,
            status: score >= 90 ? "HIGH" : score >= 75 ? "STABLE" : score >= 60 ? "WATCH" : "LOW",
            reasons
        };
    }
}

module.exports = new ConfidenceScoringService();
