"use strict";

/**
 * MILES Recommendation Engine Service
 * BUILD_038
 */

class RecommendationEngineService {
    run(learning) {
        const recommendations = [];

        this.add(recommendations, learning.confidence.score < 75, "Runtime Confidence", "Review failure and routing patterns before increasing autonomy.", "MEDIUM");
        this.add(recommendations, learning.decision.escalationRate > 35, "Governance", "Review approval thresholds; escalation rate is elevated.", "HIGH");
        this.add(recommendations, learning.failure.blockedWorkItems > 0, "Operations", "Clear blocked work items or improve capability execution map.", "HIGH");
        this.add(recommendations, learning.failure.failedWorkItems > 10, "Execution", "Analyze failed work item metadata and create recovery rules.", "MEDIUM");
        this.add(recommendations, learning.routing.skipRate > 20, "Task Router", "Improve capability detection rules for skipped items.", "MEDIUM");
        this.add(recommendations, learning.priority.urgentOpenWork > 5, "Priority", "Prioritize approval queue, blocked items, and P1/P2 work next cycle.", "HIGH");
        this.add(recommendations, recommendations.length === 0, "Autonomy", "Continue COO loop and collect additional history for stronger learning confidence.", "LOW");

        return {
            ok: true,
            action: "RECOMMENDATION_ENGINE",
            generatedAt: new Date().toISOString(),
            count: recommendations.length,
            recommendations
        };
    }

    add(list, condition, area, recommendation, severity) {
        if (!condition) return;
        list.push({
            id: `REC-${Date.now()}-${list.length + 1}`,
            area,
            severity,
            recommendation,
            owner: "MILES",
            status: "OPEN"
        });
    }
}

module.exports = new RecommendationEngineService();
