"use strict";

require("dotenv").config();
const path = require("path");
const ReplyIntelligenceProductionLoopService = require("./SERVICES/revenue/ReplyIntelligenceProductionLoopService");

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || __dirname);
  const service = new ReplyIntelligenceProductionLoopService({ rootDir, log: () => {} });
  const result = await service.runOnce();

  const summary = {
    ok: result.ok,
    status: result.status,
    mode: "READ_ONLY",
    fetched: result.fetched || {},
    latest: result.latest || {},
    cumulative: result.cumulative || {},
    alerts: result.alerts || [],
    suppressionsAddedOrConfirmed: result.suppressionsAddedOrConfirmed || 0,
    followupsScheduled: result.followupsScheduled || 0,
    manualReview: result.manualReview || 0,
    queues: result.queues || {},
    safety: result.safety || {},
    artifact: path.join(rootDir, "DATA", "runtime", "revenue", "replies", "reply_intelligence_latest.json")
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
