"use strict";

/**
 * MILES Failure Learning Service
 * BUILD_038
 */

class FailureLearningService {
    run(data) {
        const active = data.queue.current || [];
        const archive = data.queue.archive || [];
        const all = active.concat(archive);
        const failed = all.filter(item => item.status === "Failed" || item.metadata?.error || item.error);
        const blocked = active.filter(item => item.status === "Blocked");
        const runtimeFailures = this.runtimeFailures(data.runtime.cooCycleHistory || [], data.runtime.latestCOOCycle || {});
        const byArea = {};

        for (const item of failed.concat(blocked)) {
            const area = item.area || "Operations";
            byArea[area] = (byArea[area] || 0) + 1;
        }

        return {
            ok: true,
            action: "FAILURE_LEARNING",
            generatedAt: new Date().toISOString(),
            failedWorkItems: failed.length,
            blockedWorkItems: blocked.length,
            runtimeFailures,
            byArea,
            insight: this.insight(failed.length, blocked.length, runtimeFailures.length)
        };
    }

    runtimeFailures(history, latest) {
        const cycles = history.length ? history : (latest && latest.cycleId ? [latest] : []);
        return cycles.filter(c => c.status && c.status !== "OK").map(c => ({
            cycleId: c.cycleId,
            generatedAt: c.generatedAt,
            status: c.status,
            errors: c.errors || []
        }));
    }

    insight(failed, blocked, runtimeFailures) {
        if (!failed && !blocked && !runtimeFailures) return "No material failure pattern detected.";
        if (runtimeFailures) return "Runtime failures detected; keep Restart Guardian active and review latest failed cycle.";
        if (blocked) return "Blocked items need routing or capability map improvement.";
        return "Failed items exist; review failure metadata for repeat causes.";
    }
}

module.exports = new FailureLearningService();
