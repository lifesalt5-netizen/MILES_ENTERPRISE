"use strict";

const EmailInfrastructureManager = require("./EmailInfrastructureManager");

function main() {
  const manager = new EmailInfrastructureManager();
  const result = manager.queueProvisioning(5);

  console.log("[MILES ENTERPRISE] Email Infrastructure Manager");
  console.log("Inventory:");
  console.table({
    totalDomains: result.analysis.inventory.totalDomains,
    activeDomains: result.analysis.inventory.activeDomains,
    totalInboxes: result.analysis.inventory.totalInboxes,
    usableInboxes: result.analysis.inventory.usableInboxes,
    dailyCapacity: result.analysis.inventory.dailyCapacity,
    totalNeeded: result.analysis.totalNeeded
  });

  console.log("Domain Gaps:");
  console.table(result.analysis.gaps);

  console.log("Provisioning Queue Created:");
  console.table(result.created.map(x => ({
    email: x.requestedEmail,
    domain: x.domain,
    status: x.status,
    provider: x.provider
  })));
}

main();
