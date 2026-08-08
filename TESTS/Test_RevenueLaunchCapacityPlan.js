"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require("../SERVICES/revenue/RevenueLaunchCapacityPlanService");
const { parseArguments } = require("../SCRIPTS/PlanRevenueLaunchCapacity");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log("[PASS] " + name);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
  const readinessPath = path.join(root, "ready.json");
  const routes = ["Expiring GSA 12 Months", "Expiring VA 12 Months", "GSA", "VA", "8(a)", "HUBZone", "SDVOSB", "VOSB", "WOSB", "SBS"];
  const senders = Array.from({ length: 9 }, (_, index) => `sender${index}@example.com`);
  fs.writeFileSync(readinessPath, JSON.stringify({
    ok: true,
    readyToLaunch: true,
    readinessFingerprint: "F19860CAF895EE8955D1514F8F04F54954DD497D0FB1F5EC800CD7F20A33D5DB",
    summary: { verifiedLeads: 5654 },
    routes: routes.map((route, index) => ({ route, campaignId: "c" + index, paused: true, ready: true }))
  }), "utf8");

  const schedule = { schedules: [{ timezone: "America/New_York", timing: { from: "09:00", to: "17:00" } }] };
  const service = new Service({
    rootDir: root,
    readinessPath,
    outputRoot: path.join(root, "out"),
    campaignProvider: async id => {
      const index = Number(id.slice(1));
      return {
        id,
        status: 2,
        daily_limit: 0,
        campaign_schedule: schedule,
        email_list: [senders[index % senders.length]]
      };
    },
    accountProvider: async () => ({
      items: senders.map(email => ({ email, status: 1 }))
    })
  });

  await test("constructable", () => assert.ok(service));
  await test("plan only", async () => assert.strictEqual((await service.build({})).mode, "PLAN_ONLY"));
  await test("live required", () => assert.rejects(() => service.build({ apply: true }), /--live/));

  const result = await service.build({ apply: true, live: true });
  await test("plan completes", () => assert.strictEqual(result.status, "LAUNCH_CAPACITY_PLANNED"));
  await test("ten campaigns", () => assert.strictEqual(result.summary.campaigns, 10));
  await test("nine assigned senders", () => assert.strictEqual(result.summary.uniqueAssignedSenders, 9));
  await test("nine healthy assigned senders", () => assert.strictEqual(result.summary.healthyAssignedSenders, 9));
  await test("cap is 180", () => assert.strictEqual(result.summary.totalDailyEmailCap, 180));
  await test("per inbox target is 20", () => assert.strictEqual(result.summary.targetPerHealthyInbox, 20));
  await test("four step sequence accounted", () => assert.strictEqual(result.summary.sequenceSteps, 4));
  await test("steady state new lead equivalent is 45", () => assert.strictEqual(result.summary.steadyStateNewLeadEquivalent, 45));
  await test("full sequence runway calculated", () => assert.strictEqual(result.summary.estimatedSendingDaysAtFullSequence, 125.6));
  await test("all remain paused", () => assert.ok(result.campaigns.every(item => item.mustRemainPaused && item.paused)));
  await test("reference schedule preserved", () => assert.deepStrictEqual(result.referenceSchedule, schedule));
  await test("reference schedule source recorded", () => assert.strictEqual(result.referenceScheduleSource.route, "GSA"));
  await test("ready for apply", () => assert.strictEqual(result.readyForCapacityApply, true));
  await test("blocked sender excluded", () => assert.strictEqual(result.safety.blockedSender, "info@pathways2gc.com"));
  await test("bounce stop is 3 percent", () => assert.strictEqual(result.stopConditions.bounceRatePercent, 3));
  await test("spam stop is immediate", () => assert.strictEqual(result.stopConditions.spamComplaintCount, 1));
  await test("72 hour observation", () => assert.strictEqual(result.monitoring.initialObservationHours, 72));
  await test("no writes", () => assert.strictEqual(result.providerWritesAuthorized, false));
  await test("no sends", () => assert.strictEqual(result.emailsSent, false));
  await test("no launch", () => assert.strictEqual(result.campaignsLaunched, false));
  await test("authorization explicit", () => assert.match(result.authorizationRequired, /GATE_24/));
  await test("fingerprint recorded", () => assert.match(result.capacityFingerprint, /^[A-F0-9]{64}$/));
  await test("artifact exists", () => assert.ok(fs.existsSync(result.artifact.filePath)));
  await test("CLI safe", () => assert.deepStrictEqual(parseArguments([]), { apply: false, live: false }));

  const mixedSchedules = new Service({
    rootDir: root,
    readinessPath,
    outputRoot: path.join(root, "out-mixed"),
    campaignProvider: async id => {
      const index = Number(id.slice(1));
      const route = routes[index];
      return { id, status: 2, campaign_schedule: route === "GSA" ? schedule : {}, email_list: [senders[index % senders.length]] };
    },
    accountProvider: async () => ({ items: senders.map(email => ({ email, status: 1 })) })
  });
  const mixedResult = await mixedSchedules.build({ apply: true, live: true });
  await test("empty schedules are ignored", () => assert.deepStrictEqual(mixedResult.referenceSchedule, schedule));
  await test("valid GSA schedule is selected", () => assert.strictEqual(mixedResult.referenceScheduleSource.route, "GSA"));

  const noValidSchedule = new Service({
    rootDir: root,
    readinessPath,
    outputRoot: path.join(root, "out-noschedule"),
    campaignProvider: async id => {
      const index = Number(id.slice(1));
      return { id, status: 2, campaign_schedule: {}, email_list: [senders[index % senders.length]] };
    },
    accountProvider: async () => ({ items: senders.map(email => ({ email, status: 1 })) })
  });
  const noScheduleResult = await noValidSchedule.build({ apply: true, live: true });
  await test("missing valid schedule fails closed", () => assert.strictEqual(noScheduleResult.readyForCapacityApply, false));
  await test("missing valid schedule blocker recorded", () => assert.ok(noScheduleResult.blockers.includes("VALID_PROVIDER_SCHEDULE_REQUIRED")));

  const unhealthy = new Service({
    rootDir: root,
    readinessPath,
    outputRoot: path.join(root, "out-unhealthy"),
    campaignProvider: async id => {
      const index = Number(id.slice(1));
      return { id, status: 2, campaign_schedule: schedule, email_list: [senders[index % senders.length]] };
    },
    accountProvider: async () => ({ items: senders.map((email, index) => ({ email, status: index === 0 ? -1 : 1 })) })
  });
  const unhealthyResult = await unhealthy.build({ apply: true, live: true });
  await test("unhealthy sender fails closed", () => assert.strictEqual(unhealthyResult.readyForCapacityApply, false));
  await test("unhealthy sender blocker recorded", () => assert.ok(unhealthyResult.blockers.some(value => value.startsWith("SENDER_HEALTH_FAILED") || value === "NINE_HEALTHY_SENDERS_REQUIRED")));

  const blocked = new Service({
    rootDir: root,
    readinessPath,
    outputRoot: path.join(root, "out-blocked"),
    campaignProvider: async id => {
      const index = Number(id.slice(1));
      return { id, status: 2, campaign_schedule: schedule, email_list: [index === 0 ? "info@pathways2gc.com" : senders[index % senders.length]] };
    },
    accountProvider: async () => ({ items: [{ email: "info@pathways2gc.com", status: -1 }, ...senders.map(email => ({ email, status: 1 }))] })
  });
  const blockedResult = await blocked.build({ apply: true, live: true });
  await test("blocked sender fails closed", () => assert.strictEqual(blockedResult.readyForCapacityApply, false));
  await test("blocked sender blocker recorded", () => assert.ok(blockedResult.blockers.includes("BLOCKED_SENDER_PRESENT:info@pathways2gc.com")));

  console.log("REVENUE_LAUNCH_CAPACITY_PLAN_TEST_PASS " + passed + "/35");
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
