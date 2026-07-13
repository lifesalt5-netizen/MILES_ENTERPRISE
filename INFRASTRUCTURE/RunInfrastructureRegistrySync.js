"use strict";

const InfrastructureRegistrySync = require("./InfrastructureRegistrySync");

function main() {
  const result = new InfrastructureRegistrySync().run();

  console.log("[MILES ENTERPRISE] Infrastructure Registry Sync");
  console.log("Domains synced:", result.domains.length);
  console.log("Mailboxes synced:", result.mailboxes.length);

  console.log("Provisioning Plan:");
  console.table(result.plan.map(p => ({
    domain: p.domain,
    instantlyConnected: p.instantlyConnected,
    current: p.currentInboxes,
    usable: p.usableInboxes,
    target: p.targetInboxes,
    capacity: p.dailyCapacity,
    needed: p.needed,
    suggested: p.suggestedEmails.join(", ")
  })));
}

main();
