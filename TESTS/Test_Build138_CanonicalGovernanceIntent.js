"use strict";

const assert = require("assert");

const intent =
  require("../SERVICES/governance/CanonicalIntentService");

const tests = [
  {
    name: "Refresh audit",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "refresh",
        capability: "marketing.campaign.audit",
        objective: "Review paused Instantly campaigns"
      }
    },
    expected: "REFRESH"
  },
  {
    name: "Read campaigns",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "readCampaigns",
        objective: "Review reply and launch status"
      }
    },
    expected: "READ"
  },
  {
    name: "Identify paused campaigns",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "identifyPausedCampaigns"
      }
    },
    expected: "DISCOVER"
  },
  {
    name: "Evaluate deliverability risk",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "evaluateDeliverabilityRisk"
      }
    },
    expected: "ANALYZE"
  },
  {
    name: "Recommend resume or hold",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "recommendResumeOrHold"
      }
    },
    expected: "RECOMMEND"
  },
  {
    name: "Generate executive update",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "generateExecutiveUpdate"
      }
    },
    expected: "REPORT"
  },
  {
    name: "Read database status",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "readDatabaseStatus"
      }
    },
    expected: "READ"
  },
  {
    name: "Audit database health",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "auditDatabaseHealth"
      }
    },
    expected: "AUDIT"
  },
  {
    name: "Evaluate data readiness",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "evaluateDataReadiness"
      }
    },
    expected: "ANALYZE"
  },
  {
    name: "Explicit pause action",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "pauseCampaigns"
      }
    },
    expected: "PAUSE"
  },
  {
    name: "Explicit resume action",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "resumeCampaigns"
      }
    },
    expected: "RESUME"
  },
  {
    name: "Explicit send action",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        action: "sendCampaign"
      }
    },
    expected: "SEND"
  },
  {
    name: "Context-only protected command",
    task: {
      type: "WORKFORCE_STEP",
      payload: {
        command: "Pause all Instantly campaigns"
      }
    },
    expected: "PAUSE"
  }
];

let passed = 0;

for (const test of tests) {
  const result = intent.resolve(test.task);

  assert.strictEqual(
    result.intent,
    test.expected,
    `${test.name}: expected ${test.expected}, received ${result.intent}`
  );

  console.log(
    `[PASS] ${test.name}: ${result.intent} (${result.source})`
  );

  passed += 1;
}

console.log("");
console.log(
  `BUILD138_CANONICAL_INTENT_TEST_PASS ${passed}/${tests.length}`
);
