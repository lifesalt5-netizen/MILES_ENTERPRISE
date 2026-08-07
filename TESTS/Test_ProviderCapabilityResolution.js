"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "miles-gate4-"
  )
);

process.env.MILES_ROOT = tempRoot;

const connectorManager =
  require("../CORE/ConnectorManager");
const providerRouter =
  require("../SERVICES/ProviderRouterService");
const capabilityService =
  require("../SERVICES/CapabilityService");
const capabilityDispatcher =
  require("../SERVICES/CapabilityDispatcherService");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

function connector(name) {
  return {
    name,

    async healthCheck() {
      return {
        ok: true,
        status: "OK"
      };
    },

    async execute(task) {
      return {
        ok: true,
        task
      };
    }
  };
}

const milesConnector =
  connector("MILES");
const orionConnector =
  connector("ORION");

try {
  test(
    "connector registration rejects missing health",
    () => {
      assert.throws(
        () =>
          connectorManager.register(
            "BROKEN",
            {
              async execute() {
                return {
                  ok: true
                };
              }
            }
          ),
        /healthCheck\(\) is required/
      );
    }
  );

  test(
    "connector registration rejects missing execute",
    () => {
      assert.throws(
        () =>
          connectorManager.register(
            "BROKEN",
            {
              async healthCheck() {
                return {
                  ok: true
                };
              }
            }
          ),
        /execute\(\) is required/
      );
    }
  );

  test(
    "connector names normalize case",
    () => {
      connectorManager.register(
        "miles",
        milesConnector
      );

      assert.strictEqual(
        connectorManager.get("MILES"),
        milesConnector
      );
    }
  );

  test(
    "same connector registration is idempotent",
    () => {
      assert.strictEqual(
        connectorManager.register(
          "MILES",
          milesConnector
        ),
        milesConnector
      );
    }
  );

  test(
    "different connector cannot overwrite a live name",
    () => {
      assert.throws(
        () =>
          connectorManager.register(
            "miles",
            connector("replacement")
          ),
        /different implementation/
      );
    }
  );

  test(
    "second production connector registers",
    () => {
      connectorManager.register(
        "orion",
        orionConnector
      );

      assert.strictEqual(
        connectorManager.get("ORION"),
        orionConnector
      );
    }
  );

  test(
    "connector registry validates",
    () => {
      const result =
        connectorManager.validateAll();

      assert.strictEqual(
        result.ok,
        true
      );

      assert.deepStrictEqual(
        connectorManager.list(),
        ["MILES", "ORION"]
      );
    }
  );

  test(
    "provider registry validates",
    () => {
      const result =
        providerRouter
          .validateRegistry();

      assert.strictEqual(
        result.ok,
        true
      );

      assert.ok(
        result.providerCount >= 5
      );
    }
  );

  test(
    "revenue alias resolves to SalesProvider",
    () => {
      assert.strictEqual(
        providerRouter
          .normalizeProviderName(
            "Revenue"
          ),
        "SalesProvider"
      );

      assert.strictEqual(
        providerRouter
          .hasProvider(
            "revenue_operations"
          ),
        true
      );
    }
  );

  test(
    "provider authority and binding state is healthy",
    () => {
      const result =
        providerRouter.status();

      assert.strictEqual(
        result.ok,
        true
      );

      assert.strictEqual(
        result.providerAuthority.ok,
        true
      );

      assert.strictEqual(
        result.capabilityBindings.ok,
        true
      );
    }
  );

  test(
    "authoritative capability registry validates",
    () => {
      const result =
        capabilityService
          .validateRegistry(
            providerRouter
          );

      assert.strictEqual(
        result.ok,
        true
      );

      assert.ok(
        result.capabilityCount > 0
      );
    }
  );

  test(
    "sales pipeline capability resolves deterministically",
    () => {
      const result =
        capabilityService
          .resolveObjective(
            "Sales pipeline review and follow-up"
          );

      assert.strictEqual(
        result.provider,
        "SalesProvider"
      );

      assert.strictEqual(
        result.capability,
        "sales.pipeline.followup"
      );
    }
  );

  test(
    "ORION capability routes to ORION connector",
    () => {
      const route =
        capabilityDispatcher.resolve({
          action:
            "ORION_HEALTH"
        });

      assert.strictEqual(
        route.ok,
        true
      );

      assert.strictEqual(
        route.connector,
        "ORION"
      );
    }
  );

  test(
    "MILES capability routes to MILES connector",
    () => {
      const route =
        capabilityDispatcher.resolve({
          action:
            "BUSINESS_EXECUTION"
        });

      assert.strictEqual(
        route.ok,
        true
      );

      assert.strictEqual(
        route.connector,
        "MILES"
      );
    }
  );

  test(
    "local capability routes to registered service",
    () => {
      const route =
        capabilityDispatcher.resolve({
          action:
            "REPOSITORY_SEARCH"
        });

      assert.strictEqual(
        route.ok,
        true
      );

      assert.strictEqual(
        route.serviceName,
        "RepositorySearchService"
      );
    }
  );

  test(
    "unknown capability fails closed",
    () => {
      const route =
        capabilityDispatcher.resolve({
          action:
            "NOT_A_REAL_CAPABILITY"
        });

      assert.strictEqual(
        route.ok,
        false
      );

      assert.strictEqual(
        route.mode,
        "UNRESOLVED"
      );
    }
  );

  test(
    "routing registry validates live targets",
    () => {
      const result =
        capabilityDispatcher
          .validate(
            connectorManager
          );

      assert.strictEqual(
        result.ok,
        true
      );

      assert.strictEqual(
        result.errors.length,
        0
      );
    }
  );

  console.log(
    `PROVIDER_CAPABILITY_RESOLUTION_TEST_PASS ${passed}/17`
  );
} finally {
  connectorManager
    .unregister("MILES");

  connectorManager
    .unregister("ORION");

  fs.rmSync(
    tempRoot,
    {
      recursive: true,
      force: true
    }
  );
}
