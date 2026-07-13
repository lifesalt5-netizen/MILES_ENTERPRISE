"use strict";

/**
 * MILES Routing Learning Service
 * BUILD_038
 */

class RoutingLearningService {
    run(data) {
        const runs = data.routing.history || [];
        const latest = data.routing.latest || {};
        const summaries = runs.map(r => r.summary || {}).filter(Boolean);
        const routed = summaries.reduce((n, s) => n + Number(s.routed || 0), 0);
        const skipped = summaries.reduce((n, s) => n + Number(s.skipped || 0), 0);
        const awaitingApproval = summaries.reduce((n, s) => n + Number(s.awaitingApproval || 0), 0);
        const pendingBefore = summaries.reduce((n, s) => n + Number(s.pendingBefore || 0), 0);
        const routedItems = [].concat(...runs.map(r => r.routed || []));
        const capabilityCounts = {};

        for (const item of routedItems) {
            const cap = item.route?.capability || "unknown";
            capabilityCounts[cap] = (capabilityCounts[cap] || 0) + 1;
        }

        const routeRate = pendingBefore ? Math.round((routed / pendingBefore) * 100) : 0;
        const skipRate = pendingBefore ? Math.round((skipped / pendingBefore) * 100) : 0;

        return {
            ok: true,
            action: "ROUTING_LEARNING",
            generatedAt: new Date().toISOString(),
            runs: runs.length,
            latestSummary: latest.summary || null,
            totals: { pendingBefore, routed, skipped, awaitingApproval },
            routeRate,
            skipRate,
            capabilityCounts,
            insight: this.insight(routeRate, skipRate, awaitingApproval)
        };
    }

    insight(routeRate, skipRate, awaitingApproval) {
        if (skipRate > 20) return "Routing skip rate is elevated; improve capability detection or execution map coverage.";
        if (awaitingApproval > 10) return "Approval queue is accumulating; dashboard should keep approval queue prominent.";
        if (routeRate >= 70) return "Task Router is successfully converting pending work into queued work.";
        return "Routing history is still forming; continue collecting cycles.";
    }
}

module.exports = new RoutingLearningService();
