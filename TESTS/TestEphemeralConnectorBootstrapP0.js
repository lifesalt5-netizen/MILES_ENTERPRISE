"use strict";

const assert = require("assert");

process.env.MILES_ROOT = process.env.MILES_ROOT || process.cwd();

const connectorManager = require("../CORE/ConnectorManager");
const executor = require("../SCRIPTS/MilesEphemeralExecutor");

function clean(name) {
  try { connectorManager.unregister(name); } catch {}
}

(async () => {
  clean("MILES");

  assert.strictEqual(
    connectorManager.has("MILES"),
    false,
    "MILES connector must start absent in the isolated child regression."
  );

  const first = executor.ensureTaskConnector({
    id: "EPHEMERAL_CONNECTOR_TEST_001",
    type: "BUSINESS_EXECUTION",
    connector: "MILES",
    provider: "MILES",
    payload: {
      connector: "MILES",
      provider: "MILES",
      action: "BUSINESS_EXECUTION",
      plan: {
        connector: "MILES",
        provider: "MILES",
        action: "BUSINESS_EXECUTION"
      }
    }
  });

  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.status, "EPHEMERAL_CONNECTOR_REGISTERED");
  assert.strictEqual(first.connector, "MILES");
  assert.strictEqual(first.registered, true);
  assert.strictEqual(connectorManager.has("MILES"), true);

  const miles = connectorManager.get("MILES");
  assert.ok(miles, "MILES implementation must be available after bootstrap.");
  assert.strictEqual(typeof miles.healthCheck, "function");
  assert.strictEqual(typeof miles.execute, "function");

  const second = executor.ensureTaskConnector({
    connector: "MILES",
    payload: {
      action: "BUSINESS_EXECUTION"
    }
  });

  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.status, "CONNECTOR_ALREADY_REGISTERED");
  assert.strictEqual(second.registered, false);

  const unknown = executor.ensureTaskConnector({
    connector: "GOOGLE",
    provider: "GOOGLE",
    payload: {
      action: "GOOGLE_READ_ONLY_STATUS"
    }
  });

  assert.strictEqual(unknown.ok, true);
  assert.strictEqual(
    unknown.status,
    "NO_EPHEMERAL_CONNECTOR_BOOTSTRAP_REQUIRED"
  );
  assert.strictEqual(connectorManager.has("GOOGLE"), false);

  clean("MILES");

  console.log(JSON.stringify({
    ok: true,
    test: "EPHEMERAL_CONNECTOR_BOOTSTRAP_P0",
    checks: {
      processLocalRegistryStartsEmpty: true,
      requiredMilesConnectorRegisters: true,
      connectorContractValid: true,
      secondRegistrationIdempotent: true,
      unknownConnectorNotInvented: true
    }
  }, null, 2));
})().catch(error => {
  clean("MILES");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
