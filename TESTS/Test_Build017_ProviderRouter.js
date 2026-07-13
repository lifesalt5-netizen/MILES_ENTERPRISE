"use strict";

const providerRouter = require("../SERVICES/ProviderRouterService");

async function run() {
  console.log("");
  console.log("========================================");
  console.log(" MILES OS - Build 017 Provider Test");
  console.log("========================================");
  console.log("");

  console.log("Registered Providers:");
  console.log(providerRouter.status().registeredProviders.join(", "));
  console.log("");

  const marketingTask = {
    id: "TEST-MARKETING-001",
    payload: {
      workPackageId: "TEST-WP",
      objective: "Review paused Instantly campaigns",
      capability: "marketing.instantly.read",
      provider: "MarketingProvider",
      action: "refresh",
      assignedTo: "MILES",
      department: "Marketing"
    }
  };

  const orionTask = {
    id: "TEST-ORION-001",
    payload: {
      workPackageId: "TEST-WP",
      objective: "Read ORION production status",
      capability: "orion.sqlite.read",
      provider: "OrionProvider",
      action: "refresh",
      assignedTo: "MILES",
      department: "ORION"
    }
  };

  console.log("----- Marketing Provider -----");
  const marketingResult = await providerRouter.executeProviderTask(marketingTask);
  console.log("OK:", marketingResult.ok);
  console.log("Status:", marketingResult.status);
  console.log("Total Campaigns:", marketingResult.metrics.totalCampaigns);
  console.log("Active Campaigns:", marketingResult.metrics.activeCampaigns);
  console.log("Paused Campaigns:", marketingResult.metrics.pausedCampaigns);
  console.log("Exceptions:", marketingResult.exceptions.length);
  console.log("");

  console.log("----- ORION Provider -----");
  const orionResult = await providerRouter.executeProviderTask(orionTask);
  console.log("OK:", orionResult.ok);
  console.log("Status:", orionResult.status);
  console.log("Contractors:", orionResult.metrics.contractors);
  console.log("Buyers:", orionResult.metrics.buyers);
  console.log("Opportunities:", orionResult.metrics.opportunities);
  console.log("Recompetes:", orionResult.metrics.recompetes);
  console.log("Recommendations:", orionResult.metrics.recommendations);
  console.log("Personas:", orionResult.metrics.personas);
  console.log("Exceptions:", orionResult.exceptions.length);
  console.log("");

  console.log("========================================");
  console.log(" Build 017 Provider Test Complete");
  console.log("========================================");
  console.log("");
}

run().catch(err => {
  console.error("Provider test failed:");
  console.error(err);
  process.exit(1);
});