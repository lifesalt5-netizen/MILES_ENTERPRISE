"use strict";

/**
 * MILES Executive Dashboard Service
 * BUILD_037
 * Complete replacement file.
 *
 * Purpose:
 * Build a read-only CEO dashboard from the outputs of BUILD_031 through BUILD_036.
 */

const fs = require("fs");
const path = require("path");
const dashboardData = require("./DashboardDataService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "executive_dashboard");
const STATE_FILE = path.join(OUT_DIR, "dashboard_state.json");
const SUMMARY_FILE = path.join(OUT_DIR, "dashboard_summary.json");
const ALERTS_FILE = path.join(OUT_DIR, "dashboard_alerts.json");
const REPORT_FILE = path.join(OUT_DIR, "executive_dashboard_report.md");
const HTML_FILE = path.join(OUT_DIR, "index.html");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

class ExecutiveDashboardService {
    run(input = {}) {
        const startedAt = Date.now();

        console.log("");
        console.log("========================================");
        console.log(" BUILD_037 Executive Dashboard");
        console.log("========================================");

        const state = dashboardData.run({ ...input, source: "ExecutiveDashboardService" });
        this.save(state);

        const durationMs = Date.now() - startedAt;

        console.log("");
        console.log("Executive Dashboard Complete");
        console.log(`Health: ${state.executiveSummary.companyHealthStatus} (${state.executiveSummary.companyHealthScore})`);
        console.log(`Open Work: ${state.executiveSummary.openWork}`);
        console.log(`Approval Queue: ${state.executiveSummary.approvalQueue}`);
        console.log(`Dashboard: ${HTML_FILE}`);
        console.log("");

        return {
            ok: true,
            action: "EXECUTIVE_DASHBOARD",
            generatedAt: state.generatedAt,
            durationMs,
            outDir: OUT_DIR,
            dashboardHtml: HTML_FILE,
            summary: state.executiveSummary,
            alerts: state.alerts.length
        };
    }

    save(state) {
        ensureDir(OUT_DIR);
        writeJson(STATE_FILE, state);
        writeJson(SUMMARY_FILE, {
            generatedAt: state.generatedAt,
            executiveSummary: state.executiveSummary,
            cooRuntime: state.cooRuntime,
            revenue: state.revenue,
            workQueue: {
                total: state.workQueue.total,
                open: state.workQueue.open,
                pending: state.workQueue.pending,
                queued: state.workQueue.queued,
                blocked: state.workQueue.blocked,
                awaitingApproval: state.workQueue.awaitingApproval,
                failed: state.workQueue.failed,
                archived: state.workQueue.archived
            }
        });
        writeJson(ALERTS_FILE, {
            generatedAt: state.generatedAt,
            alerts: state.alerts
        });
        fs.writeFileSync(REPORT_FILE, this.renderReport(state), "utf8");
        fs.writeFileSync(HTML_FILE, this.renderHtml(state), "utf8");
    }

    renderReport(state) {
        const alerts = state.alerts.map(a => `- ${a.severity} / ${a.area}: ${a.title} — ${a.message}`).join("\n") || "- None";
        const priorities = state.companyState.priorities.map(p => `- P${p.priority} / ${p.area}: ${p.title}`).join("\n") || "- None";
        const feed = state.activityFeed.slice(0, 12).map(f => `- ${f.timestamp} / ${f.type}: ${f.title}`).join("\n") || "- None";

        return `# MILES Executive Dashboard Report

Generated: ${state.generatedAt}

## Executive Summary

Health: ${state.executiveSummary.companyHealthStatus} (${state.executiveSummary.companyHealthScore})  
Revenue: ${state.revenue.current} / ${state.revenue.goal} (${state.revenue.progressPct}%)  
Pipeline: ${state.revenue.pipeline}  
Open Work: ${state.executiveSummary.openWork}  
Approval Queue: ${state.executiveSummary.approvalQueue}  
Runtime: ${state.executiveSummary.runtimeStatus}

## COO Runtime

Latest Cycle: ${state.cooRuntime.latestCycleId || "None"}  
Status: ${state.cooRuntime.latestCycleStatus}  
Runtime Health: ${state.cooRuntime.runtimeHealthStatus}  
Restart Recommended: ${state.cooRuntime.restartRecommended ? "Yes" : "No"}

## Work Queue

Pending: ${state.workQueue.pending}  
Queued: ${state.workQueue.queued}  
In Progress: ${state.workQueue.inProgress}  
Blocked: ${state.workQueue.blocked}  
Awaiting Approval: ${state.workQueue.awaitingApproval}  
Failed: ${state.workQueue.failed}  
Archived: ${state.workQueue.archived}

## Alerts

${alerts}

## Priorities

${priorities}

## Activity Feed

${feed}
`;
    }

    renderHtml(state) {
        const card = (title, value, sub = "") => `
            <div class="card">
                <div class="card-title">${escapeHtml(title)}</div>
                <div class="card-value">${escapeHtml(value)}</div>
                <div class="card-sub">${escapeHtml(sub)}</div>
            </div>`;

        const alerts = state.alerts.map(a => `
            <tr><td>${escapeHtml(a.severity)}</td><td>${escapeHtml(a.area)}</td><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.action)}</td></tr>`).join("");

        const approvals = state.workQueue.approvalItems.map(item => `
            <tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.area)}</td><td>${escapeHtml(item.updatedAt || item.createdAt)}</td></tr>`).join("") || `<tr><td colspan="4">No approval items.</td></tr>`;

        const recentWork = state.workQueue.recentItems.map(item => `
            <tr><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.area)}</td><td>${escapeHtml(item.title)}</td></tr>`).join("");

        const feed = state.activityFeed.slice(0, 20).map(item => `
            <tr><td>${escapeHtml(item.timestamp)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.detail)}</td></tr>`).join("");

        const embedded = escapeHtml(JSON.stringify(state, null, 2));

        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MILES Executive Dashboard</title>
<style>
:root { --bg:#0f172a; --panel:#111827; --card:#1f2937; --text:#f8fafc; --muted:#94a3b8; --line:#334155; --good:#22c55e; --warn:#f59e0b; --bad:#ef4444; }
* { box-sizing:border-box; }
body { margin:0; font-family:Segoe UI, Arial, sans-serif; background:var(--bg); color:var(--text); }
header { padding:24px 32px; border-bottom:1px solid var(--line); background:#020617; position:sticky; top:0; z-index:2; }
h1 { margin:0 0 6px 0; font-size:28px; }
.small { color:var(--muted); font-size:13px; }
main { padding:24px 32px 48px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:16px; margin-bottom:24px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; box-shadow:0 8px 28px rgba(0,0,0,.2); }
.card-title { color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.08em; }
.card-value { font-size:30px; font-weight:700; margin-top:8px; }
.card-sub { color:var(--muted); margin-top:6px; font-size:13px; min-height:18px; }
section { background:var(--panel); border:1px solid var(--line); border-radius:16px; margin:0 0 20px; padding:20px; }
h2 { margin:0 0 14px; font-size:20px; }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; border-bottom:1px solid var(--line); padding:10px 8px; vertical-align:top; font-size:14px; }
th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
.badge { display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; border:1px solid var(--line); }
.status-HEALTHY, .status-OK { color:var(--good); }
.status-WATCH, .status-WARNING { color:var(--warn); }
.status-CRITICAL, .status-FAILED { color:var(--bad); }
.two { display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:20px; }
pre { white-space:pre-wrap; background:#020617; border:1px solid var(--line); border-radius:12px; padding:16px; max-height:360px; overflow:auto; color:#cbd5e1; }
a { color:#93c5fd; }
</style>
</head>
<body>
<header>
<h1>MILES Executive Dashboard</h1>
<div class="small">Generated ${escapeHtml(state.generatedAt)} · Root ${escapeHtml(state.root)} · BUILD_037 · Read-only CEO Control Center</div>
</header>
<main>
<div class="grid">
${card("Company Health", `${state.executiveSummary.companyHealthScore}`, state.executiveSummary.companyHealthStatus)}
${card("Revenue", `$${state.revenue.current}`, `${state.revenue.progressPct}% of $${state.revenue.goal} goal`)}
${card("Pipeline", `$${state.revenue.pipeline}`, `${state.revenue.proposalsOutstanding} proposals outstanding`)}
${card("Open Work", state.workQueue.open, `${state.workQueue.pending} pending / ${state.workQueue.queued} queued`)}
${card("Kevin Approval", state.workQueue.awaitingApproval, "Items requiring CEO decision")}
${card("Runtime", state.cooRuntime.runtimeHealthStatus, state.cooRuntime.latestCycleStatus)}
</div>

<div class="two">
<section>
<h2>COO Runtime</h2>
<table>
<tr><th>Metric</th><th>Value</th></tr>
<tr><td>Latest Cycle</td><td>${escapeHtml(state.cooRuntime.latestCycleId || "None")}</td></tr>
<tr><td>Status</td><td class="status-${escapeHtml(state.cooRuntime.latestCycleStatus)}">${escapeHtml(state.cooRuntime.latestCycleStatus)}</td></tr>
<tr><td>Runtime Health</td><td class="status-${escapeHtml(state.cooRuntime.runtimeHealthStatus)}">${escapeHtml(state.cooRuntime.runtimeHealthStatus)}</td></tr>
<tr><td>Duration</td><td>${escapeHtml(state.cooRuntime.latestCycleDurationMs || 0)} ms</td></tr>
<tr><td>Restart Recommended</td><td>${state.cooRuntime.restartRecommended ? "YES" : "NO"}</td></tr>
<tr><td>Recommendation</td><td>${escapeHtml(state.cooRuntime.restartRecommendation)}</td></tr>
</table>
</section>

<section>
<h2>Executive Brain</h2>
<table>
<tr><th>Metric</th><th>Value</th></tr>
<tr><td>Decision</td><td>${escapeHtml(state.executiveBrain.decision || "None")}</td></tr>
<tr><td>Priority</td><td>${escapeHtml(state.executiveBrain.priority || "None")}</td></tr>
<tr><td>Approval Required</td><td>${state.executiveBrain.approvalRequired ? "YES" : "NO"}</td></tr>
<tr><td>Work Item</td><td>${escapeHtml(state.executiveBrain.workItemId || "None")}</td></tr>
<tr><td>Next Action</td><td>${escapeHtml(state.executiveBrain.nextAction || "None")}</td></tr>
</table>
</section>
</div>

<div class="two">
<section>
<h2>Marketing / Instantly</h2>
<table>
<tr><th>Metric</th><th>Value</th></tr>
<tr><td>Status</td><td>${escapeHtml(state.marketing.status)}</td></tr>
<tr><td>Total Campaigns</td><td>${state.marketing.totalCampaigns}</td></tr>
<tr><td>Active Campaigns</td><td>${state.marketing.activeCampaigns}</td></tr>
<tr><td>Paused Campaigns</td><td>${state.marketing.pausedCampaigns}</td></tr>
<tr><td>Emails Sent Today</td><td>${state.marketing.emailsSentToday}</td></tr>
</table>
</section>

<section>
<h2>ORION</h2>
<table>
<tr><th>Metric</th><th>Value</th></tr>
<tr><td>Status</td><td>${escapeHtml(state.orion.status)}</td></tr>
<tr><td>Datasets Ready</td><td>${state.orion.datasetsReady ? "YES" : "NO"}</td></tr>
<tr><td>Last Refresh</td><td>${escapeHtml(state.orion.lastRefresh || "Unknown")}</td></tr>
<tr><td>Contractors</td><td>${state.orion.contractors}</td></tr>
<tr><td>Buyers</td><td>${state.orion.buyers}</td></tr>
</table>
</section>
</div>

<section>
<h2>Alerts</h2>
<table><tr><th>Severity</th><th>Area</th><th>Title</th><th>Action</th></tr>${alerts}</table>
</section>

<section>
<h2>Kevin Approval Queue</h2>
<table><tr><th>ID</th><th>Title</th><th>Area</th><th>Updated</th></tr>${approvals}</table>
</section>

<section>
<h2>Work Queue</h2>
<table><tr><th>Status</th><th>Priority</th><th>Area</th><th>Title</th></tr>${recentWork}</table>
</section>

<section>
<h2>Activity Feed</h2>
<table><tr><th>Time</th><th>Type</th><th>Title</th><th>Detail</th></tr>${feed}</table>
</section>

<section>
<h2>Raw Dashboard State</h2>
<pre>${embedded}</pre>
</section>
</main>
</body>
</html>`;
    }
}

module.exports = new ExecutiveDashboardService();
