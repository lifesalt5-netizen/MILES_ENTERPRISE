"use strict";

class ExecutionMonitorService {
    summarize(records = []) {
        const executed = records.filter(r => r.executed === true).length;
        const verified = records.filter(r => r.verified === true).length;
        const escalated = records.filter(r => r.status === "AWAITING_CEO_APPROVAL").length;
        const safeMode = records.filter(r => /SAFE_MODE|DRY_RUN|WAITING|NEEDS/i.test(String(r.status || ""))).length;
        const failed = records.filter(r => r.ok === false || /FAILED|ERROR/i.test(String(r.status || ""))).length;
        return {
            ok: true,
            action: "EXECUTION_MONITOR",
            generatedAt: new Date().toISOString(),
            summary: { total: records.length, executed, verified, escalated, safeMode, failed },
            status: failed ? "WATCH" : "READY"
        };
    }
}

module.exports = new ExecutionMonitorService();
