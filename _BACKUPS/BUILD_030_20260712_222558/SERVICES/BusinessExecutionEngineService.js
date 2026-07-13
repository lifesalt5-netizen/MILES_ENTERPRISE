"use strict";

const fs = require("fs");
const path = require("path");
const planner = require("./ExecutionPlannerService");
const scheduler = require("./ExecutionSchedulerService");
const dispatcher = require("./ExecutionDispatcherService");
const monitor = require("./ExecutionMonitorService");
const audit = require("./ExecutionAuditService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "business_execution");
const LATEST_FILE = path.join(OUT_DIR, "latest_business_execution.json");
const HISTORY_FILE = path.join(OUT_DIR, "business_execution_history.json");
const REPORT_FILE = path.join(OUT_DIR, "business_execution_report.md");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { if (!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class BusinessExecutionEngineService {
    async run(input = {}) {
        const started = Date.now();
        console.log("");
        console.log("========================================");
        console.log(" EXEC_005 Business Execution Engine");
        console.log("========================================");

        const dryRun = input.dryRun !== false;
        const plan = planner.buildPlan(input);
        const schedule = scheduler.schedule(plan);
        const records = [];
        const limit = Number(input.maxDispatch || 5);

        for (const task of schedule.tasks.slice(0, limit)) {
            records.push(await dispatcher.dispatch(task, { dryRun }));
        }

        const monitoring = monitor.summarize(records);
        const result = {
            ok: true,
            action: "BUSINESS_EXECUTION_ENGINE",
            type: "MILES_BUSINESS_EXECUTION_RESULT",
            build: "EXEC_005",
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
            mode: dryRun ? "DRY_RUN" : "LIVE_CONTROLLED",
            plan,
            schedule: { ok: schedule.ok, scheduled: schedule.scheduled },
            records,
            monitoring,
            auditTail: audit.recent(10),
            summary: {
                planned: plan.plannedTasks,
                dispatched: records.length,
                executed: monitoring.summary.executed,
                verified: monitoring.summary.verified,
                escalated: monitoring.summary.escalated,
                waitingProvider: records.filter(r => r.status === "WAITING_FOR_EXECUTABLE_PROVIDER").length,
                status: monitoring.status
            },
            outDir: OUT_DIR
        };

        this.save(result);
        console.log(`Planned: ${result.summary.planned}`);
        console.log(`Dispatched: ${result.summary.dispatched}`);
        console.log(`Executed: ${result.summary.executed}`);
        console.log(`Verified: ${result.summary.verified}`);
        console.log(`Status: ${result.summary.status}`);
        console.log("");
        return result;
    }

    save(result) {
        ensureDir(OUT_DIR);
        writeJson(LATEST_FILE, result);
        const hist = readJson(HISTORY_FILE, []);
        hist.push(result);
        writeJson(HISTORY_FILE, hist.slice(-500));
        fs.writeFileSync(REPORT_FILE, this.renderReport(result), "utf8");
    }

    renderReport(result) {
        const lines = result.records.length ? result.records.map(r => `- ${r.task?.provider}/${r.task?.operation}: ${r.status}`).join("\n") : "- No tasks dispatched.";
        return `# EXEC_005 Business Execution Engine Report\n\nGenerated: ${result.generatedAt}\nMode: ${result.mode}\n\n## Summary\n\nPlanned: ${result.summary.planned}  \nDispatched: ${result.summary.dispatched}  \nExecuted: ${result.summary.executed}  \nVerified: ${result.summary.verified}  \nEscalated: ${result.summary.escalated}  \nWaiting Provider: ${result.summary.waitingProvider}  \nStatus: ${result.summary.status}\n\n## Dispatch Records\n\n${lines}\n`;
    }
}

module.exports = new BusinessExecutionEngineService();
