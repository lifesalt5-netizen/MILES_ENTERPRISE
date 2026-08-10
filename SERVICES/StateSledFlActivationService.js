"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_fl_activation_rules.json");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(options = {}) {
  const rules = loadJson(RULES_FILE);
  const authorization = String(options.authorization || process.env.MILES_STATE_SLED_ACTIVATION_AUTH || "").trim();
  const executeLive = options.executeLive === true || String(process.env.MILES_STATE_SLED_ACTIVATE_LIVE || "").toLowerCase() === "true";

  assert(authorization === rules.authorizationToken, "P1.3M activation authorization token missing or incorrect.");
  assert(executeLive, "P1.3M live activation flag is not enabled.");

  const readinessFile = path.join(ROOT, rules.launchReadinessFile);
  assert(fs.existsSync(readinessFile), `Launch readiness artifact not found: ${readinessFile}`);
  const readiness = loadJson(readinessFile);

  assert(readiness.readyForLaunchApproval === true, "Launch readiness is not approved-ready.");
  assert(Array.isArray(readiness.failedChecks) && readiness.failedChecks.length === 0, "Launch readiness contains failed checks.");
  assert(String(readiness.campaignId) === String(rules.campaignId), "Launch readiness campaign ID mismatch.");
  assert(String(readiness.campaignName) === String(rules.campaignName), "Launch readiness campaign name mismatch.");
  assert(Number(readiness.campaignStatus) === Number(rules.requiredReadiness.requiredPreLaunchStatus), "Campaign is not in required pre-launch status.");
  assert(Number(readiness.leadCountObserved) >= Number(rules.requiredReadiness.minimumLeadCount), "Observed lead count is below launch minimum.");
  assert(Array.isArray(readiness.assignedHealthySenders) && readiness.assignedHealthySenders.includes(rules.requiredReadiness.requiredSender), "Required healthy sender is not assigned.");
  assert(Number(readiness.sequenceStepCount) === Number(rules.requiredReadiness.requiredSequenceSteps), "Sequence step count mismatch.");

  process.env.MILES_DRY_RUN = "false";
  process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "true";
  const connector = require("../CONNECTORS/INSTANTLY/connector");

  const beforeResult = await connector.execute({ action: "GET_CAMPAIGN", payload: { campaign_id: rules.campaignId } });
  const before = beforeResult?.campaign || beforeResult?.result || {};

  assert(String(before.id || rules.campaignId) === String(rules.campaignId), "Live campaign ID mismatch before activation.");
  assert(String(before.name || "").trim().toUpperCase() === rules.campaignName.toUpperCase(), "Live campaign name mismatch before activation.");

  if (Number(before.status) === 1) {
    return {
      ok: true,
      gate: rules.gate,
      state: rules.state,
      campaignId: rules.campaignId,
      campaignName: rules.campaignName,
      alreadyActive: true,
      activatedNow: false,
      finalCampaignStatus: Number(before.status),
      activationAuthorized: true
    };
  }

  assert(Number(before.status) === Number(rules.requiredReadiness.requiredPreLaunchStatus), `Unexpected pre-activation status: ${before.status}`);

  await connector.execute({ action: "ACTIVATE_CAMPAIGN", payload: { campaign_id: rules.campaignId } });

  const afterResult = await connector.execute({ action: "GET_CAMPAIGN", payload: { campaign_id: rules.campaignId } });
  const after = afterResult?.campaign || afterResult?.result || {};

  assert(Number(after.status) === 1, `Campaign activation verification failed. Final status=${after.status}`);

  const summary = {
    ok: true,
    gate: rules.gate,
    state: rules.state,
    campaignId: rules.campaignId,
    campaignName: rules.campaignName,
    alreadyActive: false,
    activatedNow: true,
    finalCampaignStatus: Number(after.status),
    activationAuthorized: true,
    verifiedLeadCountAtAuthorization: readiness.leadCountObserved,
    senderEmails: readiness.assignedHealthySenders,
    sequenceStepCount: readiness.sequenceStepCount,
    schedule: readiness.schedule
  };

  const outDir = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "ACTIVATION");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "STATE_SLED_FL_ACTIVATION_RESULT.json"), JSON.stringify(summary, null, 2));

  return summary;
}

module.exports = { run };
