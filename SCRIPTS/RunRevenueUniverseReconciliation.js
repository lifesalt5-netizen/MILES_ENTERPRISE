"use strict";

const service = require("../SERVICES/revenue/RevenueUniverseReconciliationService");

const objective = [
  "Reconcile the full ORION contractor universe into the P2GC revenue lifecycle.",
  "Treat the current governed master as one outbound subset, not the total addressable market.",
  "For every contractor produce an evidence-backed commercial disposition and next-action state.",
  "Companies with stale or missing contacts must remain visible for qualification or enrichment rather than disappearing.",
  "Return the defensible lower-bound count of commercially viable prospects, verified current decision-makers, contractors actually being contacted, market coverage, campaign-ready idle inventory, and the explicit unresolved qualification population.",
  "Do not send email, activate campaigns, mutate providers, override suppression, or modify production ORION."
].join(" ");

Promise.resolve(service.execute({
  source: "MILES_REMOTE_EXECUTION_BRIDGE",
  action: "REVENUE_UNIVERSE_RECONCILIATION",
  capability: "revenue.universe_reconciliation",
  provider: "MILES",
  connector: "MILES",
  objective,
  payload: {
    objective,
    activationPolicy: "STAGING_ONLY_NO_AUTO_SEND_NO_SUPPRESSION_OVERRIDE"
  }
})).then(result => {
  const compact = {
    ok: result?.ok === true,
    status: result?.status || null,
    service: result?.service || null,
    mode: result?.mode || null,
    completedAt: result?.completedAt || null,
    universe: result?.universe || null,
    immediateAnswers: result?.immediateAnswers || null,
    acceptance: result?.acceptance || null,
    outputs: result?.outputs || null,
    safety: result?.safety || null,
    error: result?.error || null
  };
  console.log("MILES_REVENUE_UNIVERSE_RECONCILIATION_COMPACT");
  console.log(JSON.stringify(compact, null, 2));
  if (result?.ok !== true) process.exitCode = 2;
}).catch(error => {
  console.error("MILES_REVENUE_UNIVERSE_RECONCILIATION_FAILED");
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
