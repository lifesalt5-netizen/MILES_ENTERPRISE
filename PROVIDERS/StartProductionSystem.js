"use strict";

require("dotenv").config();

const ProductionCOOEngine = require("./SERVICES/ProductionCOOEngine");
const ExecutionRouterService = require("./SERVICES/ExecutionRouterService");
const AutonomousRevenueClosureLoop = require("./SERVICES/AutonomousRevenueClosureLoop");

const buildConnectors = require("./CONNECTORS");

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function bool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(String(v).toLowerCase());
}

async function main() {

  console.log("\n[MILES] ==================================");
  console.log("[MILES] AUTONOMOUS PRODUCTION SYSTEM v2");
  console.log("[MILES] ==================================\n");

  // =========================
  // CONNECTORS LAYER
  // =========================
  const connectors = buildConnectors({
    gmail: { enabled: bool("GMAIL_ENABLED", false) },
    instantly: { enabled: bool("INSTANTLY_ENABLED", false) },
    crm: { enabled: bool("CRM_ENABLED", false) },
    webhook: { enabled: bool("WEBHOOK_ENABLED", false) }
  });

  // =========================
  // CORE SYSTEMS
  // =========================
  const router = new ExecutionRouterService({ connectors });

  const engine = new ProductionCOOEngine({
    connectors,
    allowExecution: bool("ALLOW_EXECUTION", false)
  });

  const revenueLoop = new AutonomousRevenueClosureLoop({
    connectors
  });

  console.log("[MILES] System initialized");
  console.log("[MILES] Execution Mode:", bool("ALLOW_EXECUTION", false));

  // =========================
  // MAIN AUTONOMOUS LOOP
  // =========================
  while (true) {

    try {

      console.log("\n[MILES] ------------------------------");
      console.log("[MILES] NEW CYCLE STARTING");
      console.log("[MILES] ------------------------------");

      // 1. COO DECISION ENGINE
      const result = await engine.runCycle();

      console.log("[MILES] COO Cycle Complete");
      console.log("[MILES] Health:", result?.health?.overallScore);
      console.log("[MILES] Autonomy:", result?.autonomy?.overall);

      // 2. EXECUTION ROUTER (actions from COO)
      const plan = result?.mission?.priorities || [];

      if (plan.length > 0) {

        const actions = plan.map(p => ({
          type: mapActionType(p.area),
          payload: {
            title: p.title,
            area: p.area,
            priority: p.priority
          }
        }));

        const executionResults = await router.execute(actions);

        console.log("[MILES] Execution Results:", executionResults.length);
      }

      // 3. REVENUE CLOSURE LOOP (REAL BUSINESS ENGINE)
      const revenue = await revenueLoop.run(result);

      console.log("\n[MILES] REVENUE LOOP COMPLETE");
      console.log("[MILES] Leads:", revenue.state.stages.ingested);
      console.log("[MILES] Qualified:", revenue.state.stages.qualified);
      console.log("[MILES] Outreach:", revenue.state.stages.outreach);
      console.log("[MILES] CRM:", revenue.state.stages.crm);
      console.log("[MILES] Follow-ups:", revenue.state.stages.followups);

      // 4. FINAL STATUS
      console.log("\n[MILES] Cycle Finished Successfully");

    } catch (err) {

      console.error("[MILES] CYCLE ERROR:", err.message);
    }

    // 5. CONTROLLED LOOP DELAY
    const interval = Number(process.env.CYCLE_INTERVAL_MS || 15000);
    await sleep(interval);
  }
}

// =========================
// ACTION MAPPING
// =========================
function mapActionType(area) {

  if (!area) return "WEBHOOK";

  const a = String(area).toLowerCase();

  if (a.includes("email")) return "GMAIL";
  if (a.includes("instant")) return "INSTANTLY";
  if (a.includes("crm")) return "CRM";

  return "WEBHOOK";
}

main().catch(err => {
  console.error("[MILES] FATAL ERROR:", err.message);
  process.exit(1);
});