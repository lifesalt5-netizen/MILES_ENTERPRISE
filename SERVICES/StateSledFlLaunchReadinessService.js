"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RULES_FILE = path.join(ROOT, "CONFIG", "state_sled_fl_launch_readiness_rules.json");

function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
}

function unwrapItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function boolEq(actual, expected) {
  if (expected === undefined) return true;
  return Boolean(actual) === Boolean(expected);
}

function getSchedule(campaign) {
  const schedules = campaign?.campaign_schedule?.schedules;
  return Array.isArray(schedules) && schedules.length ? schedules[0] : null;
}

function sequenceStepCount(campaign) {
  const sequences = Array.isArray(campaign?.sequences) ? campaign.sequences : [];
  if (!sequences.length) return 0;
  const steps = Array.isArray(sequences[0]?.steps) ? sequences[0].steps : [];
  return steps.length;
}

function selectHealthySenders(accounts, rules) {
  const minimumScore = Number(rules.senderPolicy?.minimumWarmupScore || 70);
  return unwrapItems(accounts).filter(account => {
    const status = Number(account.status);
    const warmupStatus = Number(account.warmup_status);
    const setupPending = account.setup_pending === true;
    const rawScore = account.stat_warmup_score;
    const score = rawScore === undefined || rawScore === null || rawScore === "" ? null : Number(rawScore);
    if (!account.email || status !== 1 || setupPending) return false;
    if (warmupStatus < 0) return false;
    if (score !== null && Number.isFinite(score) && score < minimumScore) return false;
    return true;
  });
}

async function run() {
  const rules = loadRules();
  const connector = require("../CONNECTORS/INSTANTLY/connector");

  const campaignResult = await connector.execute({
    action: "GET_CAMPAIGN",
    payload: { campaign_id: rules.campaignId }
  });
  const campaign = campaignResult?.campaign || campaignResult?.result || {};

  const accountResult = await connector.execute({
    action: "LIST_SENDING_ACCOUNTS",
    payload: { limit: 100 }
  });
  const healthySenders = selectHealthySenders(accountResult?.accounts, rules);

  const leadResult = await connector.execute({
    action: "LIST_LEADS",
    payload: { campaign: rules.campaignId, campaign_id: rules.campaignId, limit: 100 }
  });
  const leads = unwrapItems(leadResult?.leads || leadResult?.result || leadResult);

  const schedule = getSchedule(campaign);
  const senderEmails = Array.isArray(campaign?.email_list) ? campaign.email_list : [];
  const healthySenderEmailSet = new Set(healthySenders.map(x => String(x.email).toLowerCase()));
  const assignedHealthySenders = senderEmails.filter(email => healthySenderEmailSet.has(String(email).toLowerCase()));

  const required = rules.requiredCampaign || {};
  const checks = {
    campaignExists: Boolean(campaign?.id),
    campaignIdExact: String(campaign?.id || "") === String(rules.campaignId),
    campaignNameExact: String(campaign?.name || "").trim() === rules.campaignName,
    campaignNotActive: Number(campaign?.status) !== 1,
    verifiedLeadCountMet: leads.length >= Number(rules.expectedVerifiedLeadCount || 0),
    senderAssigned: senderEmails.length >= Number(rules.senderPolicy?.minimumHealthySenders || 1),
    assignedSenderHealthy: assignedHealthySenders.length >= Number(rules.senderPolicy?.minimumHealthySenders || 1),
    dailyLimitCorrect: Number(campaign?.daily_limit) === Number(required.daily_limit),
    stopOnReplyCorrect: boolEq(campaign?.stop_on_reply, required.stop_on_reply),
    linkTrackingOff: boolEq(campaign?.link_tracking, required.link_tracking),
    openTrackingOff: boolEq(campaign?.open_tracking, required.open_tracking),
    riskyContactsOff: boolEq(campaign?.allow_risky_contacts, required.allow_risky_contacts),
    schedulePresent: Boolean(schedule),
    scheduleTimezoneCorrect: String(schedule?.timezone || "") === String(rules.requiredSchedule?.timezone || ""),
    scheduleTimeCorrect: String(schedule?.timing?.from || "") === String(rules.requiredSchedule?.from || "") && String(schedule?.timing?.to || "") === String(rules.requiredSchedule?.to || ""),
    sequenceStepCountCorrect: sequenceStepCount(campaign) === Number(rules.requiredSequenceSteps || 0),
    noLaunchSafety: rules.safety?.activateCampaigns === false && rules.safety?.instantlyReadOnly === true
  };

  const failedChecks = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  const readyForLaunchApproval = failedChecks.length === 0;

  const result = {
    ok: true,
    gate: rules.gate,
    state: rules.state,
    campaignId: campaign?.id || rules.campaignId,
    campaignName: campaign?.name || rules.campaignName,
    campaignStatus: campaign?.status ?? null,
    leadCountObserved: leads.length,
    expectedVerifiedLeadCount: Number(rules.expectedVerifiedLeadCount || 0),
    assignedSenders: senderEmails,
    assignedHealthySenders,
    sequenceStepCount: sequenceStepCount(campaign),
    schedule,
    checks,
    failedChecks,
    readyForLaunchApproval,
    authorizedToActivate: false,
    safety: rules.safety
  };

  const outDir = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "LAUNCH_READINESS");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "STATE_SLED_FL_LAUNCH_READINESS.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  return { ...result, outputFile: outFile };
}

module.exports = { run, selectHealthySenders, sequenceStepCount, getSchedule };
