"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const target = path.join(ROOT, "SERVICES", "WorkQueueService.js");
const queuePath = path.join(ROOT, "DATA", "runtime", "work_queue.json");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const backupDir = path.join(ROOT, "runtime", `governance_final_backup_${stamp}`);

function fail(message) {
    throw new Error(message);
}

function copyIfExists(source, destination) {
    if (!fs.existsSync(source)) return;

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: options.capture ? "pipe" : "inherit",
        ...options
    });

    if (result.status !== 0) {
        if (result.stdout) console.error(result.stdout);
        if (result.stderr) console.error(result.stderr);

        fail(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
    }

    return result;
}

async function main() {
    console.log("============================================================");
    console.log("MILES FINAL GOVERNANCE REPAIR");
    console.log("============================================================");

    if (!fs.existsSync(target)) {
        fail(`Missing file: ${target}`);
    }

    fs.mkdirSync(backupDir, { recursive: true });

    copyIfExists(
        target,
        path.join(backupDir, "SERVICES", "WorkQueueService.js")
    );

    copyIfExists(
        queuePath,
        path.join(backupDir, "DATA", "runtime", "work_queue.json")
    );

    console.log("Backup:", backupDir);

    let source = fs.readFileSync(target, "utf8");

    const oldGovernanceBlock = `        if (PROTECTED_GOVERNANCE_TERMS.test(fullText)) {
            return {
                requiresKevin: true,
                executionType: "APPROVAL_REQUIRED",
                reason: "Protected executive action detected."
            };
        }

        if (
            AUTONOMOUS_OPERATIONAL_EXCEPTION_TYPES.has(type) ||
            /WebsiteProviderLoadFailure|provider load failure|provider initialization|connector failure|health check failure|runtime failure/i.test(
                fullText
            )
        ) {
            return {
                requiresKevin: false,
                executionType: "WORKFLOW",
                reason: "Operational diagnosis and repair may proceed autonomously."
            };
        }`;

    const newGovernanceBlock = `        /*
          Exact operational failures must be classified before broad protected
          terms. Provider messages may mention a website domain without asking
          MILES to change DNS, publish, transfer, or otherwise mutate it.
        */
        if (
            AUTONOMOUS_OPERATIONAL_EXCEPTION_TYPES.has(type) ||
            /WebsiteProviderLoadFailure|provider load failure|provider initialization|connector failure|health check failure|runtime failure/i.test(
                fullText
            )
        ) {
            return {
                requiresKevin: false,
                executionType: "WORKFLOW",
                reason: "Operational diagnosis and repair may proceed autonomously."
            };
        }

        if (PROTECTED_GOVERNANCE_TERMS.test(fullText)) {
            return {
                requiresKevin: true,
                executionType: "APPROVAL_REQUIRED",
                reason: "Protected executive action detected."
            };
        }`;

    if (!source.includes(oldGovernanceBlock)) {
        fail(
            "Expected governance block was not found. No production file was changed."
        );
    }

    source = source.replace(
        "this.schemaVersion = 4;",
        "this.schemaVersion = 5;"
    );

    source = source.replace(
        oldGovernanceBlock,
        newGovernanceBlock
    );

    const oldStatusBlock = `        item.requiresKevin = classification.requiresKevin;
        item.executionType = classification.executionType;

        const changed =
            beforeRequiresKevin !== item.requiresKevin ||
            beforeExecutionType !== item.executionType;`;

    const newStatusBlock = `        item.requiresKevin = classification.requiresKevin;
        item.executionType = classification.executionType;

        const beforeStatus = item.status;

        if (
            classification.requiresKevin === false &&
            item.status === "Awaiting Approval"
        ) {
            item.status = "Pending";
        }

        const changed =
            beforeRequiresKevin !== item.requiresKevin ||
            beforeExecutionType !== item.executionType ||
            beforeStatus !== item.status;`;

    if (!source.includes(oldStatusBlock)) {
        fail(
            "Expected status migration block was not found. No production file was changed."
        );
    }

    source = source.replace(
        oldStatusBlock,
        newStatusBlock
    );

    const tempFile = `${target}.replacement_${process.pid}_${Date.now()}.js`;

    fs.writeFileSync(tempFile, source, "utf8");

    run("node", ["--check", tempFile]);

    fs.copyFileSync(tempFile, target);
    fs.unlinkSync(tempFile);

    console.log("Installed complete WorkQueueService replacement.");

    run("node", ["--check", target]);

    delete require.cache[require.resolve("./SERVICES/WorkQueueService")];

    const WorkQueueService = require("./SERVICES/WorkQueueService");
    const queue = new WorkQueueService();

    queue.load();

    const websiteItems = queue.getAll().filter(item =>
        /WebsiteProviderLoadFailure|Repair Website|WebsiteProvider/i.test(
            [
                item.area,
                item.title,
                item.description,
                item.metadata?.type,
                item.metadata?.exception?.type,
                item.metadata?.repair?.type,
                item.metadata?.repair?.metadata?.exception?.type
            ]
                .filter(Boolean)
                .join(" ")
        )
    );

    console.log(
        "Website work:",
        JSON.stringify(
            websiteItems.map(item => ({
                id: item.id,
                title: item.title,
                status: item.status,
                requiresKevin: item.requiresKevin,
                executionType: item.executionType
            })),
            null,
            2
        )
    );

    console.log(
        "Queue stats:",
        JSON.stringify(queue.getStats(), null, 2)
    );

    const stillBlocked = websiteItems.filter(item =>
        item.requiresKevin === true ||
        item.executionType === "APPROVAL_REQUIRED"
    );

    if (stillBlocked.length > 0) {
        fail(
            `Website operational work remains blocked: ${JSON.stringify(stillBlocked)}`
        );
    }

    if (queue.getAuthorizedPending().length < 1) {
        fail("No authorized pending work exists after migration.");
    }

    console.log("Running Autonomous COO validation cycle...");

    run("node", ["StartAutonomousCOO.js"]);

    console.log("Starting MILES production...");

    const stdout = fs.openSync(
        path.join(ROOT, "runtime", `FinalGovernance_${stamp}.stdout.log`),
        "a"
    );

    const stderr = fs.openSync(
        path.join(ROOT, "runtime", `FinalGovernance_${stamp}.stderr.log`),
        "a"
    );

    const production = spawn(
        "node",
        ["StartMilesProduction.js"],
        {
            cwd: ROOT,
            detached: true,
            stdio: ["ignore", stdout, stderr]
        }
    );

    production.unref();

    console.log("");
    console.log("============================================================");
    console.log("FINAL GOVERNANCE REPAIR COMPLETE");
    console.log("============================================================");
    console.log("Production PID:", production.pid);
    console.log("Backup:", backupDir);
    console.log("");
    console.log("Operational provider diagnosis and repair is autonomous.");
    console.log("Publishing, DNS mutations, pricing, contracts, legal actions,");
    console.log("payments, deletion, and hiring remain CEO-protected.");
}

main().catch(error => {
    console.error("");
    console.error("FINAL REPAIR FAILED:", error.message);
    process.exitCode = 1;
});

