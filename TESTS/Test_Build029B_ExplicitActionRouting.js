"use strict";

const assert = require("assert");
const planner = require("../SERVICES/CommandIntentPlannerService");

function main() {
  const explicitStatus = planner.plan({
    command: "Miles, run STATUS."
  });

  assert.strictEqual(explicitStatus.action, "STATUS");

  const longMission = planner.plan({
    command: [
      "Miles, own Instantly end to end with Google Workspace, Namecheap,",
      "LinkedIn, existing segmented lead files, verified leads, campaigns,",
      "replies, follow-up, deliverability, and capacity.",
      "Identify every campaign and its status.",
      "Return completed work, active work, blockers, and CEO approvals only."
    ].join(" ")
  });

  assert.strictEqual(longMission.intent, "REVENUE_OPERATIONS");
  assert.strictEqual(longMission.action, "BUSINESS_EXECUTION");
  assert.notStrictEqual(longMission.action, "STATUS");

  const review = planner.plan({
    command: "Miles, review Instantly campaign health, replies, warmup, and deliverability."
  });

  assert.strictEqual(review.action, "INSTANTLY_LIVE");

  const genericStatusMention = planner.plan({
    command: "Review campaign status and execute the authorized outbound work."
  });

  assert.notStrictEqual(genericStatusMention.action, "STATUS");

  console.log(JSON.stringify({
    ok: true,
    build: "029B",
    tests: {
      explicitStatusStillWorks: "PASSED",
      embeddedStatusNoLongerHijacksMission: "PASSED",
      revenueMissionRoutesToBusinessExecution: "PASSED",
      instantlyReviewStillRoutesLive: "PASSED",
      genericStatusMentionDoesNotForceStatus: "PASSED"
    },
    plans: {
      explicitStatus,
      longMission,
      review,
      genericStatusMention
    }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

