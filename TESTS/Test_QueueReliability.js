"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "miles-gate3-")
);
const repositoryRoot = path.resolve(__dirname, "..");

process.env.MILES_ROOT = root;
process.env.MILES_QUEUE_LOCK_TIMEOUT_MS = "250";
process.env.MILES_QUEUE_LOCK_RETRY_MS = "10";
process.env.MILES_QUEUE_LOCK_STALE_MS = "50";
process.env.MILES_QUEUE_RETRY_DELAY_MS = "0";

const queueModulePath = path.join(
    repositoryRoot,
    "CORE",
    "TaskQueue.js"
);
const taskQueue = require(queueModulePath);
const queuePath = path.join(
    root,
    "DATA",
    "runtime",
    "task_queue.json"
);
const lastGoodPath = path.join(
    root,
    "DATA",
    "runtime",
    "task_queue.last_good.json"
);
const lockPath = path.join(
    root,
    "DATA",
    "runtime",
    "task_queue.lock"
);

let passed = 0;

function check(name, fn) {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
}

try {
    check("queue is created as valid persistent JSON", () => {
        assert.ok(fs.existsSync(queuePath));
        assert.deepStrictEqual(
            JSON.parse(fs.readFileSync(queuePath, "utf8")),
            []
        );
    });

    taskQueue.add({
        id: "PARENT",
        type: "TEST",
        priority: 5,
        status: "QUEUED"
    });
    taskQueue.add({
        id: "CHILD",
        type: "TEST",
        priority: 1,
        status: "QUEUED",
        dependsOn: ["PARENT"]
    });

    const parentClaim = taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0,
        claimedBy: "gate3-test"
    });

    check("dependency prevents premature child execution", () => {
        assert.strictEqual(parentClaim.id, "PARENT");
        assert.strictEqual(parentClaim.status, "RUNNING");
        assert.strictEqual(
            taskQueue.list().find(task => task.id === "CHILD").status,
            "QUEUED"
        );
    });

    taskQueue.update("PARENT", {
        status: "COMPLETED",
        completedAt: new Date().toISOString()
    });

    const childClaim = taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0,
        claimedBy: "gate3-test"
    });

    check("completed dependency releases child", () => {
        assert.strictEqual(childClaim.id, "CHILD");
        assert.strictEqual(childClaim.status, "RUNNING");
    });

    taskQueue.update("CHILD", {
        status: "COMPLETED",
        completedAt: new Date().toISOString()
    });

    taskQueue.add({
        id: "MISSING_DEPENDENCY",
        type: "TEST",
        status: "QUEUED",
        dependsOn: ["DOES_NOT_EXIST"]
    });

    const missingClaim = taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0
    });

    check("missing dependency fails closed", () => {
        assert.strictEqual(missingClaim, null);
        const task = taskQueue.list().find(
            item => item.id === "MISSING_DEPENDENCY"
        );
        assert.strictEqual(task.status, "BLOCKED");
        assert.match(task.error, /not found/i);
    });

    taskQueue.add({
        id: "FAILED_PARENT",
        type: "TEST",
        status: "FAILED"
    });
    taskQueue.add({
        id: "FAILED_CHILD",
        type: "TEST",
        status: "QUEUED",
        dependsOn: ["FAILED_PARENT"]
    });

    taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0
    });

    check("failed dependency blocks dependent work", () => {
        const task = taskQueue.list().find(
            item => item.id === "FAILED_CHILD"
        );
        assert.strictEqual(task.status, "BLOCKED");
        assert.match(task.error, /ended as FAILED/);
    });

    taskQueue.add({
        id: "CYCLE_A",
        type: "TEST",
        status: "QUEUED",
        dependsOn: ["CYCLE_B"]
    });
    taskQueue.add({
        id: "CYCLE_B",
        type: "TEST",
        status: "QUEUED",
        dependsOn: ["CYCLE_A"]
    });

    taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0
    });

    check("dependency cycles fail closed", () => {
        for (const id of ["CYCLE_A", "CYCLE_B"]) {
            const task = taskQueue.list().find(
                item => item.id === id
            );
            assert.strictEqual(task.status, "BLOCKED");
            assert.match(task.error, /cycle detected/i);
        }
    });

    taskQueue.add({
        id: "RETRYABLE",
        type: "TEST",
        status: "FAILED",
        retryable: true,
        retryCount: 0,
        maxRetries: 1,
        updatedAt: "2000-01-01T00:00:00.000Z"
    });

    const retryClaim = taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0,
        claimedBy: "gate3-test"
    });

    check("retryable failure is requeued and claimed once", () => {
        assert.strictEqual(retryClaim.id, "RETRYABLE");
        assert.strictEqual(retryClaim.retryCount, 1);
        assert.strictEqual(retryClaim.attemptCount, 1);
    });

    taskQueue.update("RETRYABLE", {
        status: "FAILED",
        retryable: true,
        failedAt: "2000-01-01T00:00:00.000Z"
    });

    const exhaustedClaim = taskQueue.claimNextExecutableTask({
        staleAfterMs: 600000,
        retryDelayMs: 0
    });

    check("retry budget is bounded", () => {
        assert.strictEqual(exhaustedClaim, null);
        const task = taskQueue.list().find(
            item => item.id === "RETRYABLE"
        );
        assert.strictEqual(task.status, "FAILED");
        assert.strictEqual(task.retryCount, 1);
    });

    taskQueue.add({
        id: "INTERRUPTED",
        type: "TEST",
        status: "RUNNING",
        startedAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z"
    });

    const recoveredClaim = taskQueue.claimNextExecutableTask({
        staleAfterMs: 1,
        retryDelayMs: 0,
        claimedBy: "gate3-restart-test"
    });

    check("stale running task recovers after restart", () => {
        assert.strictEqual(recoveredClaim.id, "INTERRUPTED");
        assert.strictEqual(recoveredClaim.status, "RUNNING");
        assert.strictEqual(recoveredClaim.recoveryCount, 1);
        assert.strictEqual(recoveredClaim.recovery.recovered, true);
    });

    taskQueue.update("INTERRUPTED", {
        status: "COMPLETED"
    });

    check("last-good snapshot remains valid", () => {
        assert.ok(fs.existsSync(lastGoodPath));
        assert.ok(
            Array.isArray(
                JSON.parse(
                    fs.readFileSync(lastGoodPath, "utf8")
                )
            )
        );
    });

    check("queue survives module reload", () => {
        delete require.cache[require.resolve(queueModulePath)];
        const reloaded = require(queueModulePath);
        assert.ok(
            reloaded.list().some(
                task => task.id === "INTERRUPTED"
            )
        );
    });

    fs.mkdirSync(lockPath);
    fs.writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify({
            pid: process.pid,
            token: "live-owner",
            acquiredAt: "2000-01-01T00:00:00.000Z"
        }),
        "utf8"
    );

    check("live queue lock is never stolen", () => {
        assert.throws(
            () => taskQueue.list(),
            /lock could not be acquired/i
        );
        assert.ok(fs.existsSync(lockPath));
    });

    fs.rmSync(lockPath, {
        recursive: true,
        force: true
    });
    fs.mkdirSync(lockPath);
    fs.writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify({
            pid: 2147483647,
            token: "dead-owner",
            acquiredAt: "2000-01-01T00:00:00.000Z"
        }),
        "utf8"
    );

    check("dead stale lock is reclaimed", () => {
        assert.ok(Array.isArray(taskQueue.list()));
        assert.strictEqual(fs.existsSync(lockPath), false);
    });

    check("claims persist attempt ownership evidence", () => {
        const persisted = taskQueue.list().find(
            task => task.id === "INTERRUPTED"
        );
        assert.strictEqual(persisted.status, "COMPLETED");
        assert.strictEqual(
            persisted.claim.claimedBy,
            "gate3-restart-test"
        );
        assert.ok(persisted.claim.claimedAt);
    });

    check("queue remains parseable after all transitions", () => {
        const persisted = JSON.parse(
            fs.readFileSync(queuePath, "utf8")
        );
        assert.ok(Array.isArray(persisted));
        assert.ok(persisted.length >= 9);
    });

    console.log(
        `QUEUE_RELIABILITY_TEST_PASS ${passed}/${passed}`
    );
} finally {
    fs.rmSync(root, {
        recursive: true,
        force: true
    });
}
