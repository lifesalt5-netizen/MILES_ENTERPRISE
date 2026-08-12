"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function read(file) { return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""); }
function backupWrite(file, source) {
  const backup = `${file}.bak_outbound_governance_${Date.now()}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, source, "utf8");
  return backup;
}

function patchMarketingProvider() {
  const file = path.join(ROOT, "PROVIDERS", "providers", "MarketingProvider.js");
  let src = read(file);

  if (!src.includes("OutboundLeadGovernanceConvergenceService")) {
    const anchor = 'const InstantlyCOOService =\n  require("../../SERVICES/digital_coo/InstantlyCOOService");';
    if (!src.includes(anchor)) throw new Error("MARKETING_PROVIDER_IMPORT_ANCHOR_NOT_FOUND");
    src = src.replace(anchor, `${anchor}\nconst OutboundLeadGovernanceConvergenceService = require("../../SERVICES/OutboundLeadGovernanceConvergenceService");\nconst OutboundRevenueReadinessService = require("../../SERVICES/OutboundRevenueReadinessService");\nconst OutboundReplyGovernanceService = require("../../SERVICES/OutboundReplyGovernanceService");`);
  }

  if (!src.includes("async governedLeadConvergence(")) {
    const anchor = "  async auditCampaignHealth() {";
    if (!src.includes(anchor)) throw new Error("MARKETING_PROVIDER_METHOD_ANCHOR_NOT_FOUND");
    const methods = `  async governedLeadConvergence() {\n    return new OutboundLeadGovernanceConvergenceService({ rootDir: ROOT }).run();\n  }\n\n  async outboundRevenueReadiness() {\n    return new OutboundRevenueReadinessService({\n      rootDir: ROOT,\n      instantly: this.instantlyCOO\n    }).run();\n  }\n\n  async classifyOutboundReplies(task = {}) {\n    const payload = getTaskPayload(task);\n    const messages = Array.isArray(payload.messages) ? payload.messages : [];\n    return OutboundReplyGovernanceService.processBatch(messages);\n  }\n\n  async monthlyLeadRefreshAudit() {\n    const convergence = new OutboundLeadGovernanceConvergenceService({ rootDir: ROOT }).run();\n    return {\n      ok: convergence.ok,\n      gate: "MONTHLY_LEAD_REFRESH_AUDIT",\n      refreshRegistry: convergence.outputs.refreshRegistry,\n      liveCampaignsMutated: false,\n      nextAction: "READ_MONTHLY_REFRESH_REGISTRY_AND_CREATE_HIGH_PRIORITY_TASKS_FOR_SOURCES_AT_OR_OVER_30_DAYS"\n    };\n  }\n\n`;
    src = src.replace(anchor, methods + anchor);
  }

  for (const marker of ["async governedLeadConvergence(", "async outboundRevenueReadiness(", "async classifyOutboundReplies(", "async monthlyLeadRefreshAudit("]) {
    if (!src.includes(marker)) throw new Error(`MARKETING_PROVIDER_VALIDATION_FAILED:${marker}`);
  }
  return { file, backup: backupWrite(file, src) };
}

function replacePlanner() {
  const file = path.join(ROOT, "SERVICES", "BusinessWorkPlannerService.js");
  const source = `"use strict";\n\n/*\n  MILES Business Work Planner — Outbound Revenue Governance\n  Converts CEO business objectives into safe, executable work packages.\n  Live external writes remain separately governed.\n*/\n\nclass BusinessWorkPlannerService {\n  async plan(task = {}) {\n    const objective = task.objective || task.payload?.objective || task.command || "";\n    const text = String(objective).toLowerCase();\n    const outboundRelevant = /outbound|email|lead|campaign|instantly|mailbox|reply|revenue|meeting|marketing|segment|dedup|verify|sled|state/.test(text);\n\n    const workPackages = [];\n\n    if (outboundRelevant) {\n      workPackages.push({\n        priority: 1, taskType: "GOVERNED_LEAD_CONVERGENCE", provider: "Marketing",\n        action: "governedLeadConvergence", capability: "LEAD_GOVERNANCE",\n        description: "Discover approved federal and SLED lead assets, restore verified-email truth, deduplicate, and enforce one-company/one-campaign priority without live writes."\n      });\n      workPackages.push({\n        priority: 2, taskType: "OUTBOUND_REVENUE_READINESS", provider: "Marketing",\n        action: "outboundRevenueReadiness", capability: "OUTBOUND_REVENUE_READINESS",\n        description: "Reconcile governed verified segments against live Instantly campaigns, mailboxes, capacity, and launch blockers without live writes."\n      });\n      workPackages.push({\n        priority: 3, taskType: "REFRESH_CAMPAIGN_INVENTORY", provider: "Marketing",\n        action: "auditCampaignHealth", capability: "CAMPAIGN_INVENTORY", description: "Refresh live campaign inventory."\n      });\n      workPackages.push({\n        priority: 4, taskType: "REFRESH_SENDING_ACCOUNT_INVENTORY", provider: "Marketing",\n        action: "auditCapacity", capability: "SENDING_ACCOUNT_INVENTORY", description: "Refresh mailbox inventory and capacity."\n      });\n      workPackages.push({\n        priority: 5, taskType: "AUDIT_MONTHLY_SOURCE_REFRESH", provider: "Marketing",\n        action: "monthlyLeadRefreshAudit", capability: "MONTHLY_SOURCE_REFRESH", description: "Audit 30-day lead-source refresh governance."\n      });\n      if (/reply|inbox|ooo|bounce|unsubscribe|spam/.test(text)) {\n        workPackages.push({\n          priority: 6, taskType: "REPLY_GOVERNANCE", provider: "Marketing",\n          action: "classifyOutboundReplies", capability: "REPLY_CLASSIFICATION",\n          description: "Apply governed reply classification and routing rules to supplied reply records."\n        });\n      }\n    } else {\n      workPackages.push({\n        priority: 1, taskType: "REFRESH_CAMPAIGN_INVENTORY", provider: "Marketing",\n        action: "auditCampaignHealth", capability: "CAMPAIGN_INVENTORY", description: "Refresh current operating state before planning."\n      });\n      workPackages.push({\n        priority: 2, taskType: "BUILD_EXECUTION_QUEUE", provider: "MILES",\n        action: "QUEUE_WORK", capability: "COO_EXECUTION_QUEUE", description: "Create prioritized execution queue for the CEO objective."\n      });\n    }\n\n    return { ok: true, service: "BusinessWorkPlannerService", objective, generatedAt: new Date().toISOString(), workPackageCount: workPackages.length, workPackages };\n  }\n}\n\nmodule.exports = new BusinessWorkPlannerService();\nmodule.exports.BusinessWorkPlannerService = BusinessWorkPlannerService;\n`;
  return { file, backup: backupWrite(file, source) };
}

const result = {
  ok: true,
  gate: "INSTALL_OUTBOUND_COO_GOVERNANCE",
  marketingProvider: patchMarketingProvider(),
  planner: replacePlanner(),
  liveWritesEnabled: false,
  installedCapabilities: ["LEAD_GOVERNANCE","OUTBOUND_REVENUE_READINESS","REPLY_CLASSIFICATION","MONTHLY_SOURCE_REFRESH"],
  removedLegacyPlannerRisks: ["Revenue/LOAD_SEGMENTS connector dependency", "Revenue/COMPARE connector dependency"],
  nextAction: "SYNTAX_CHECK_TEST_AND_RESTART_MILES"
};
console.log(JSON.stringify(result, null, 2));
