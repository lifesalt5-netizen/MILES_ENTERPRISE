"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";

function now() {
  return new Date().toISOString();
}

function safeReadJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

class EngineeringPlannerService {
  constructor() {
    this.runtimeFile = path.join(ROOT, "DATA", "runtime", "latest_coo_cycle.json");
    this.healthFile = path.join(ROOT, "DATA", "executive", "latest_universal_health.json");
    this.repairFile = path.join(ROOT, "DATA", "autonomous_repair", "latest_repair_plan.json");
    this.outputDir = path.join(ROOT, "DATA", "self_engineering");
    this.outputFile = path.join(this.outputDir, "latest_engineering_plan.json");
  }

  analyze() {
    fs.mkdirSync(this.outputDir, { recursive: true });

    const runtime = safeReadJson(this.runtimeFile, {});
    const health = safeReadJson(this.healthFile, {});
    const repair = safeReadJson(this.repairFile, {});

    const findings = [];
    const tasks = [];

    for (const system of health.systems || []) {
      if (system.risk === "HIGH" || system.status === "Critical") {
        findings.push({
          type: "SYSTEM_HEALTH_RISK",
          severity: system.risk === "HIGH" ? "Critical" : "Warning",
          area: system.area,
          message: `${system.area} is ${system.status} with risk ${system.risk}.`,
          source: "latest_universal_health.json"
        });
      }
    }

    for (const repairItem of repair.repairs || []) {
      findings.push({
        type: "REPAIR_CANDIDATE",
        severity: repairItem.severity || "Warning",
        area: repairItem.area,
        message: repairItem.problem || repairItem.title,
        source: "latest_repair_plan.json",
        safeAutonomous: repairItem.safeAutonomous,
        requiresKevin: repairItem.requiresKevin
      });
    }

    for (const finding of findings) {
      const plan = this.planRepair(finding);
      if (plan) tasks.push(plan);
    }

    const result = {
      ok: true,
      generatedAt: now(),
      runtimeCycleId: runtime.cycleId || null,
      autonomy: runtime.autonomy || null,
      findings,
      tasks,
      summary: {
        findings: findings.length,
        tasks: tasks.length,
        autonomousTasks: tasks.filter(t => t.autoRepair === true).length,
        approvalRequired: tasks.filter(t => t.requiresKevin === true).length
      }
    };

    fs.writeFileSync(this.outputFile, JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  planRepair(finding = {}) {
    const text = [
      finding.type,
      finding.area,
      finding.message
    ].filter(Boolean).join(" ").toLowerCase();

    if (/website/.test(text)) {
      return {
        id: `ENG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        createdAt: now(),
        priority: 90,
        area: "Website",
        title: "Repair or improve Website COO condition",
        problem: finding.message,
        targetFiles: [
          "CONNECTORS/WEBSITE/website.js",
          "PROVIDERS/providers/WebsiteProvider.js",
          "SERVICES/ExecutiveIntelligenceService.js"
        ],
        autoRepair: true,
        requiresKevin: false,
        allowedActions: [
          "verify connector path",
          "verify provider loads",
          "run website audit",
          "repair missing metrics",
          "repair provider registration"
        ],
        blockedActions: [
          "publish website edits",
          "change public website content",
          "delete files"
        ],
        testCommands: [
          "node -e \"require('../CONNECTORS/WEBSITE/website'); console.log('website connector ok')\"",
          "node -e \"const W=require('../PROVIDERS/providers/WebsiteProvider'); (async()=>{const w=new W(); await w.initialize(); console.log(JSON.stringify(w.getProviderState(),null,2));})();\"",
          "node StartAutonomousCOO.js"
        ],
        verification: "WebsiteProvider loads, refreshes, reports metrics, and MILES completes one autonomous COO cycle."
      };
    }

    if (/marketing|instantly|campaign/.test(text)) {
      return {
        id: `ENG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        createdAt: now(),
        priority: 85,
        area: "Marketing",
        title: "Repair or improve Marketing COO condition",
        problem: finding.message,
        targetFiles: [
          "PROVIDERS/providers/MarketingProvider.js",
          "CONNECTORS/INSTANTLY/instantly.js",
          "SERVICES/Browser/Workers/InstantlyCampaignOperator.js"
        ],
        autoRepair: true,
        requiresKevin: false,
        allowedActions: [
          "verify provider loads",
          "verify connector loads",
          "verify browser operator loads",
          "repair require paths",
          "repair safe audit logic"
        ],
        blockedActions: [
          "launch campaigns",
          "send emails",
          "resume campaigns without approval",
          "delete leads"
        ],
        testCommands: [
          "node -e \"const M=require('../PROVIDERS/providers/MarketingProvider'); (async()=>{const m=new M(); await m.initialize(); console.log(JSON.stringify(m.getProviderState(),null,2));})();\"",
          "node StartAutonomousCOO.js"
        ],
        verification: "MarketingProvider loads, refreshes, reports campaign metrics, and does not perform sending changes."
      };
    }

    if (/orion|database/.test(text)) {
      return {
        id: `ENG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        createdAt: now(),
        priority: 80,
        area: "ORION",
        title: "Repair or improve ORION COO condition",
        problem: finding.message,
        targetFiles: [
          "PROVIDERS/providers/OrionProvider.js"
        ],
        autoRepair: true,
        requiresKevin: false,
        allowedActions: [
          "verify provider loads",
          "verify database path",
          "verify read-only counts",
          "repair safe read logic"
        ],
        blockedActions: [
          "delete database records",
          "drop tables",
          "modify schema without approval"
        ],
        testCommands: [
          "node -e \"const O=require('../PROVIDERS/providers/OrionProvider'); (async()=>{const o=new O(); await o.initialize(); console.log(JSON.stringify(o.getProviderState(),null,2));})();\"",
          "node StartAutonomousCOO.js"
        ],
        verification: "ORIONProvider loads, refreshes, reports database health, and MILES completes one autonomous COO cycle."
      };
    }

    return {
      id: `ENG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      createdAt: now(),
      priority: 60,
      area: finding.area || "Engineering",
      title: "Review engineering finding",
      problem: finding.message || "Unknown engineering issue.",
      targetFiles: [],
      autoRepair: false,
      requiresKevin: true,
      allowedActions: [
        "diagnose",
        "prepare repair recommendation"
      ],
      blockedActions: [
        "modify source without classification"
      ],
      testCommands: [
        "node StartAutonomousCOO.js"
      ],
      verification: "Issue is classified and either safely repaired or escalated."
    };
  }
}

module.exports = new EngineeringPlannerService();