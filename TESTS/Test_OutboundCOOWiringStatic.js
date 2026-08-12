"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

const marketing = fs.readFileSync(path.join(ROOT, "PROVIDERS", "providers", "MarketingProvider.js"), "utf8");
const planner = fs.readFileSync(path.join(ROOT, "SERVICES", "BusinessWorkPlannerService.js"), "utf8");

const checks = {
  governedLeadMethod: marketing.includes("async governedLeadConvergence("),
  readinessMethod: marketing.includes("async outboundRevenueReadiness("),
  replyGovernanceMethod: marketing.includes("async classifyOutboundReplies("),
  monthlyRefreshMethod: marketing.includes("async monthlyLeadRefreshAudit("),
  plannerLeadGovernance: planner.includes('action: "governedLeadConvergence"'),
  plannerReadiness: planner.includes('action: "outboundRevenueReadiness"'),
  plannerMonthlyRefresh: planner.includes('action: "monthlyLeadRefreshAudit"'),
  noLegacyRevenueLoadSegments: !planner.includes('action: "LOAD_SEGMENTS"'),
  noLegacyRevenueCompare: !planner.includes('provider: "Revenue"')
};
const failed = Object.entries(checks).filter(([,ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed.length === 0, gate: "OUTBOUND_COO_WIRING_STATIC", checks, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
