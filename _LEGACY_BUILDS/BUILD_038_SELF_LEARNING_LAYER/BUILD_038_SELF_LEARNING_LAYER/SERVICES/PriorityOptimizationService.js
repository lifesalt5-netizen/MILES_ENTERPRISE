"use strict";

/**
 * MILES Priority Optimization Service
 * BUILD_038
 */

class PriorityOptimizationService {
    run(data) {
        const open = (data.queue.current || []).filter(item => ["Pending", "Queued", "In Progress", "Blocked", "Awaiting Approval"].includes(item.status));
        const byPriority = {};
        const byArea = {};
        const urgent = [];

        for (const item of open) {
            const priority = Number(item.priority || 3);
            byPriority[priority] = (byPriority[priority] || 0) + 1;
            const area = item.area || "Operations";
            byArea[area] = (byArea[area] || 0) + 1;
            if (priority <= 2 || item.status === "Blocked" || item.status === "Awaiting Approval") urgent.push(item);
        }

        return {
            ok: true,
            action: "PRIORITY_OPTIMIZATION",
            generatedAt: new Date().toISOString(),
            openWork: open.length,
            urgentOpenWork: urgent.length,
            byPriority,
            byArea,
            topAreas: Object.entries(byArea).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([area, count]) => ({ area, count })),
            insight: this.insight(open.length, urgent.length)
        };
    }

    insight(open, urgent) {
        if (!open) return "No open work; generate next operational objectives.";
        if (urgent > 10) return "Urgent work is high; focus execution on P1/P2 and approval queue.";
        if (open > 50) return "Open work volume is high; consider batching and archiving stale work.";
        return "Open work volume is manageable.";
    }
}

module.exports = new PriorityOptimizationService();
