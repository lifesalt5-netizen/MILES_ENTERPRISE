"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/engineering/PersistentEngineeringMemoryService"
);
const { parseArguments } = require(
  "../SCRIPTS/RecordEngineeringMemory"
);

let passed = 0;
function test(name, action) {
  action();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

(function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-memory-"));
  let now = Date.parse("2026-08-07T12:00:00Z");
  const service = new Service({ rootDir: root, now: () => (now += 10) });
  const first = {
    eventType: "GATE_LOCKED",
    gate: "Engineering Autonomy Gate 5",
    status: "LOCKED",
    summary: "Governed GitHub workflow accepted and merged.",
    repositoryFingerprint: "A".repeat(64),
    pullRequest: 19,
    mergeSha: "a".repeat(40),
    evidence: ["C:/acceptance/gate5"]
  };

  test("persistent memory service is constructable", () =>
    assert.strictEqual(service.service, "PERSISTENT_ENGINEERING_MEMORY"));
  const preview = service.record(first);
  test("default mode is plan-only", () => assert.strictEqual(preview.mode, "PLAN_ONLY"));
  test("preview performs no writes", () => assert.strictEqual(fs.existsSync(service.ledgerPath), false));
  test("event identity is deterministic", () => assert.match(preview.event.identityHash, /^[A-F0-9]{64}$/));
  test("first event links to genesis", () => assert.strictEqual(preview.event.previousHash, "GENESIS"));

  const recorded = service.record({ ...first, apply: true });
  test("apply persists first event", () => assert.strictEqual(recorded.writesPerformed, true));
  test("ledger is created", () => assert.strictEqual(fs.existsSync(service.ledgerPath), true));
  test("snapshot is created", () => assert.strictEqual(fs.existsSync(service.snapshotPath), true));
  test("ledger has integrity hash", () => assert.match(recorded.ledgerSha256, /^[A-F0-9]{64}$/));
  test("snapshot reports locked gate", () => assert.strictEqual(recorded.snapshot.lockedGateCount, 1));
  test("lock is released", () => assert.strictEqual(fs.existsSync(service.lockPath), false));

  const duplicate = service.record({ ...first, apply: true });
  test("duplicate event is idempotent", () => assert.strictEqual(duplicate.duplicate, true));
  test("duplicate does not append", () => assert.strictEqual(duplicate.snapshot.eventCount, 1));

  const secondInput = {
    eventType: "MILESTONE_LOCKED",
    gate: "Engineering Autonomy",
    status: "LOCKED",
    summary: "All engineering autonomy gates passed.",
    repositoryFingerprint: "B".repeat(64),
    pullRequest: 20,
    mergeSha: "b".repeat(40),
    evidence: ["C:/acceptance/gate6"]
  };
  const second = service.record({ ...secondInput, apply: true });
  test("second event appends", () => assert.strictEqual(second.snapshot.eventCount, 2));
  test("hash chain links events", () => assert.strictEqual(second.event.previousHash, recorded.event.eventHash));
  test("snapshot reports locked milestone", () => assert.strictEqual(second.snapshot.lockedMilestoneCount, 1));
  test("ledger reload validates", () => assert.strictEqual(service.readLedger().length, 2));

  test("tampered ledger fails closed", () => {
    const original = fs.readFileSync(service.ledgerPath, "utf8");
    fs.writeFileSync(service.ledgerPath, original.replace("All engineering", "Changed engineering"));
    assert.throws(() => service.readLedger(), /CHAIN_INVALID/);
    fs.writeFileSync(service.ledgerPath, original);
  });
  test("invalid merge SHA fails closed", () =>
    assert.throws(() => service.record({ ...first, mergeSha: "bad" }), /MERGE_SHA_INVALID/));
  test("invalid repository fingerprint fails closed", () =>
    assert.throws(() => service.record({ ...first, repositoryFingerprint: "bad" }), /FINGERPRINT_INVALID/));
  test("concurrent lock fails closed", () => {
    fs.writeFileSync(service.lockPath, "locked");
    assert.throws(() => service.record({ ...first, summary: "Distinct valid event", apply: true }), /LOCK_UNAVAILABLE/);
    fs.unlinkSync(service.lockPath);
  });
  test("memory writes grant no source Git merge or deployment authority", () => {
    assert.strictEqual(second.sourceWritesPerformed, false);
    assert.strictEqual(second.gitWritesPerformed, false);
    assert.strictEqual(second.mergePerformed, false);
    assert.strictEqual(second.deploymentPerformed, false);
  });
  test("CLI defaults to plan-only", () =>
    assert.deepStrictEqual(parseArguments(["--event=C:/event.json"]), {
      eventPath: path.resolve("C:/event.json"),
      apply: false
    }));

  console.log(`PERSISTENT_ENGINEERING_MEMORY_TEST_PASS ${passed}/23`);
  fs.rmSync(root, { recursive: true, force: true });
})();

