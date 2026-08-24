"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const GmailExecutiveTriageProductionLoopService = require("../SERVICES/revenue/GmailExecutiveTriageProductionLoopService");

function skippedPersonalGmail(overrides = {}) {
  return {
    ok: false,
    destination: "kevin@pathways2gc.com",
    eligibleBusinessAccounts: 0,
    skippedOutOfBusinessScope: 1,
    blockers: [],
    safety: { businessScopeOnly: true, outOfScopeAccountsAreNotReadOrMutated: true },
    accounts: [{
      account: "default",
      accountKey: "default",
      scope: "OUT_OF_BUSINESS_SCOPE",
      scopeReason: "BUSINESS_TRIAGE_ACCOUNT_NOT_APPROVED",
      skipped: true,
      ok: true,
      messagesInspected: 0,
      forwarded: 0,
      archived: 0,
      ...overrides
    }]
  };
}

function healthyIonos() {
  return {
    ok: true,
    mode: "ACTIVE_READ_ONLY_MAILBOX",
    errors: [],
    safety: { mailboxReadOnly: true, noSmtp: true, noMailboxMutation: true }
  };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-gmail-loop-"));
  const oldName = process.env.MILES_RUNTIME_NAME;
  const oldGeneration = process.env.MILES_RUNTIME_GENERATION;
  const oldGuardPid = process.env.MILES_RUNTIME_GUARD_PID;

  try {
    process.env.MILES_RUNTIME_NAME = "miles-autonomous-coo";
    process.env.MILES_RUNTIME_GENERATION = "test-generation";
    process.env.MILES_RUNTIME_GUARD_PID = "999";

    const loop = new GmailExecutiveTriageProductionLoopService({
      root,
      enabled: true,
      execute: true,
      service: { run: async () => skippedPersonalGmail() }
    });
    loop.ionosService = { run: async () => healthyIonos() };

    const result = await loop.runOnce();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, "ACTIVE");
    assert.strictEqual(result.components.gmail.ok, true);
    assert.strictEqual(result.components.gmail.serviceOk, false);
    assert.strictEqual(result.components.gmail.intentionallySkippedAllOutOfScope, true);
    assert.strictEqual(result.components.ionos.ok, true);
    assert.deepStrictEqual(result.blockers, []);

    const artifact = JSON.parse(fs.readFileSync(result.artifact, "utf8"));
    assert.strictEqual(artifact.status, "ACTIVE");
    assert.strictEqual(artifact.producer.runtimeName, "miles-autonomous-coo");
    assert.strictEqual(artifact.producer.runtimeGeneration, "test-generation");
    assert.strictEqual(artifact.producer.runtimeGuardPid, "999");
    assert.strictEqual(artifact.accounts[0].messagesInspected, 0);
    assert.strictEqual(artifact.accounts[0].forwarded, 0);
    assert.strictEqual(artifact.accounts[0].archived, 0);

    const unsafe = new GmailExecutiveTriageProductionLoopService({
      root,
      enabled: true,
      execute: true,
      service: { run: async () => skippedPersonalGmail({ forwarded: 1 }) }
    });
    unsafe.ionosService = { run: async () => healthyIonos() };
    const unsafeResult = await unsafe.runOnce();
    assert.strictEqual(unsafeResult.ok, false);
    assert.strictEqual(unsafeResult.status, "BLOCKED");
    assert.strictEqual(unsafeResult.components.gmail.intentionallySkippedAllOutOfScope, false);
    assert(unsafeResult.blockers.some(item => item.blocker === "GMAIL_COMPONENT_NOT_HEALTHY"));

    const ionosDown = new GmailExecutiveTriageProductionLoopService({
      root,
      enabled: true,
      execute: true,
      service: { run: async () => ({ ...skippedPersonalGmail(), ok: true }) }
    });
    ionosDown.ionosService = { run: async () => ({ ok: false, mode: "BLOCKED", errors: [], safety: {} }) };
    const ionosResult = await ionosDown.runOnce();
    assert.strictEqual(ionosResult.ok, false);
    assert.strictEqual(ionosResult.status, "BLOCKED");
    assert(ionosResult.blockers.some(item => item.blocker === "IONOS_COMPONENT_NOT_HEALTHY"));

    console.log("GMAIL_TRIAGE_PRODUCTION_STATUS_TRUTH=GREEN");
    console.log("OUT_OF_SCOPE_PERSONAL_GMAIL_ZERO_TOUCH_HEALTH=GREEN");
  } finally {
    if (oldName === undefined) delete process.env.MILES_RUNTIME_NAME; else process.env.MILES_RUNTIME_NAME = oldName;
    if (oldGeneration === undefined) delete process.env.MILES_RUNTIME_GENERATION; else process.env.MILES_RUNTIME_GENERATION = oldGeneration;
    if (oldGuardPid === undefined) delete process.env.MILES_RUNTIME_GUARD_PID; else process.env.MILES_RUNTIME_GUARD_PID = oldGuardPid;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
