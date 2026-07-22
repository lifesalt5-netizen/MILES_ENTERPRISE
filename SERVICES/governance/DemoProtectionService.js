"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

const POLICY_FILE =
  path.join(
    ROOT,
    "GOVERNANCE",
    "demo_access_policy.json"
  );

function load() {
  return JSON.parse(
    fs.readFileSync(
      POLICY_FILE,
      "utf8"
    )
  );
}

function textOf(input = {}) {
  const task =
    input.task ||
    input;

  const payload =
    task.payload ||
    {};

  return [
    task.type,
    task.action,
    task.intent,
    task.workflow,
    payload.action,
    payload.capability,
    payload.objective,
    payload.command,
    payload.requestedView
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

class DemoProtectionService {
  isDemo(input = {}) {
    const task =
      input.task ||
      input;

    const payload =
      task.payload ||
      {};

    return (
      input.demoMode === true ||
      task.demoMode === true ||
      payload.demoMode === true ||
      String(
        process.env.MILES_DEMO_MODE ||
        ""
      ).toLowerCase() === "true"
    );
  }

  evaluate(input = {}) {
    const policy = load();
    const demoMode =
      this.isDemo(input);

    if (!demoMode) {
      return {
        allowed: true,
        demoMode: false,
        reason:
          "Demo protection not active.",
        policyVersion:
          policy.version
      };
    }

    const text =
      textOf(input);

    const blockedPattern =
      policy.blockedPatterns
        .find(pattern =>
          text.includes(
            String(pattern)
              .toUpperCase()
          )
        ) || null;

    return {
      allowed:
        !blockedPattern,
      demoMode: true,
      blockedPattern,
      redactImplementationDetails: true,
      redactRawEnterpriseData: true,
      reason:
        blockedPattern
          ? `Demo policy blocked protected detail: ${blockedPattern}.`
          : "Demo-safe request.",
      policyVersion:
        policy.version
    };
  }
}

module.exports =
  new DemoProtectionService();