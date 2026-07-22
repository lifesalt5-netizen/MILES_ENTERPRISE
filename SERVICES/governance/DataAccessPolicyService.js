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
    "data_access_policy.json"
  );

function load() {
  return JSON.parse(
    fs.readFileSync(
      POLICY_FILE,
      "utf8"
    )
  );
}

class DataAccessPolicyService {
  evaluate(input = {}) {
    const policy = load();

    const task =
      input.task ||
      input;

    const payload =
      task.payload ||
      {};

    const role =
      String(
        input.role ||
        payload.role ||
        task.role ||
        process.env.MILES_ACTOR_ROLE ||
        "MILES"
      ).toUpperCase();

    const provider =
      String(
        input.provider ||
        payload.provider ||
        task.provider ||
        "MILES"
      ).toUpperCase();

    const classification =
      String(
        input.classification ||
        payload.dataClassification ||
        task.dataClassification ||
        policy.providers[provider] ||
        policy.defaultClassification
      ).toUpperCase();

    const grants =
      policy.roles[role] || [];

    const roleAllowed =
      grants.includes(classification);

    const entitlementRequired =
      classification ===
        "CLIENT_LICENSED" ||
      (
        classification ===
          "ENTERPRISE_INTELLIGENCE" &&
        role === "CLIENT"
      );

    const entitled =
      !entitlementRequired ||
      Boolean(
        input.entitled ||
        payload.entitled ||
        task.entitled
      );

    const clientId =
      input.clientId ||
      payload.clientId ||
      task.clientId ||
      null;

    const requestedClientId =
      input.requestedClientId ||
      payload.requestedClientId ||
      task.requestedClientId ||
      clientId;

    const clientIsolated =
      role !== "CLIENT" ||
      !clientId ||
      clientId === requestedClientId;

    const allowed =
      roleAllowed &&
      entitled &&
      clientIsolated;

    return {
      allowed,
      role,
      provider,
      classification,
      roleAllowed,
      entitlementRequired,
      entitled,
      clientIsolated,
      reason:
        !roleAllowed
          ? `Role ${role} may not access ${classification}.`
          : !entitled
            ? "Required data entitlement is missing."
            : !clientIsolated
              ? "Client isolation policy blocked cross-client access."
              : "Data access policy satisfied.",
      policyVersion:
        policy.version
    };
  }
}

module.exports =
  new DataAccessPolicyService();