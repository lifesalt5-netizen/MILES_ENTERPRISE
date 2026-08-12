"use strict";

const discovery = require("../SERVICES/VerifiedEmailInventoryDiscoveryService");

try {
  const result = discovery.run();

  const output = {
    ok: Boolean(result.ok && result.usableCount > 0 && result.best),
    gate: "VERIFIED_EMAIL_INVENTORY_DISCOVERY",
    candidateCount: result.candidateCount,
    usableCount: result.usableCount,
    best: result.best,
    usable: result.usable,
    liveCampaignsMutated: result.liveCampaignsMutated,
    canonicalInventoryMutated: result.canonicalInventoryMutated,
    nextAction: result.nextAction,
    outFile: result.outFile
  };

  console.log(JSON.stringify(output, null, 2));

  if (!output.ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    gate: "VERIFIED_EMAIL_INVENTORY_DISCOVERY",
    error: error.stack || error.message
  }, null, 2));
  process.exitCode = 1;
}
