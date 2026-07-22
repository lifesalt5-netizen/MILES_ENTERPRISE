"use strict";

const capabilityService = require("./SERVICES/CapabilityService");
const workflowService = require("./SERVICES/WorkflowService");
const workPackages = require("./SERVICES/WorkPackageService");

const baseObjective = "Review paused Instantly campaigns";
const diagnosticObjective =
    `${baseObjective} diagnostic ${new Date().toISOString()}`;

function compactStep(step = {}) {
    return {
        step: step.step,
        capability: step.capability,
        provider: step.provider,
        action: step.action,
        taskType: step.taskType,
        assignedTo: step.assignedTo,
        department: step.department
    };
}

console.log("\n=== ENVIRONMENT CHECK ===");
console.log({
    INSTANTLY_API_KEY_PRESENT:
        Boolean(String(process.env.INSTANTLY_API_KEY || "").trim()),
    INSTANTLY_WRITE_ENABLED:
        process.env.INSTANTLY_WRITE_ENABLED || "(not set)",
    NODE_ENV:
        process.env.NODE_ENV || "(not set)"
});

console.log("\n=== DIRECT CAPABILITY PLAN ===");

try {
    const capabilityPlan =
        capabilityService.planObjective(baseObjective, {
            source: "DIAGNOSTIC",
            provider: "Marketing"
        });

    const steps =
        capabilityPlan?.operationalPlan?.steps || [];

    console.log(JSON.stringify({
        requiredCapabilities:
            capabilityPlan?.requiredCapabilities || [],
        assignments:
            capabilityPlan?.assignments || [],
        stepCount:
            steps.length,
        steps:
            steps.map(compactStep)
    }, null, 2));
} catch (error) {
    console.error("CAPABILITY_PLAN_ERROR");
    console.error(error.stack || error.message);
}

console.log("\n=== FRESH WORKFLOW TEST ===");
console.log("Objective:", diagnosticObjective);

try {
    const result =
        workflowService.createWorkflow(diagnosticObjective, {
            source: "STALE_PACKAGE_DIAGNOSTIC",
            priority: "HIGH",
            provider: "Marketing"
        });

    console.log(JSON.stringify({
        ok: result?.ok,
        status: result?.status,
        packageId: result?.workPackage?.id,
        packageCreatedAt: result?.workPackage?.createdAt,
        reused: result?.workPackage?.reused,
        creationDecision:
            result?.workPackage?.creationDecision,
        packageTaskCount:
            result?.workPackage?.tasks?.length || 0,
        planStepCount:
            result?.workPackage?.plan?.steps?.length || 0,
        queuedTaskCount:
            result?.queuedTasks?.length || 0,
        packageTasks:
            (result?.workPackage?.tasks || []).map(compactStep),
        queuedTasks:
            (result?.queuedTasks || []).map(task => ({
                id: task.id,
                type: task.type || task.taskType,
                status: task.status,
                provider:
                    task.provider ||
                    task.payload?.provider ||
                    task.data?.provider,
                action:
                    task.action ||
                    task.payload?.action ||
                    task.data?.action
            }))
    }, null, 2));
} catch (error) {
    console.error("WORKFLOW_CREATION_ERROR");
    console.error(error.stack || error.message);
}

console.log("\n=== INVALID ACTIVE PACKAGES ===");

const activeStatuses = new Set([
    "AWAITING_APPROVAL",
    "QUEUED",
    "READY",
    "RUNNING",
    "IN_PROGRESS",
    "IN PROGRESS",
    "BLOCKED"
]);

const invalid = workPackages.list().filter(pkg => {
    const status =
        String(pkg.status || "")
            .replace(/-/g, "_")
            .toUpperCase();

    const tasks =
        Array.isArray(pkg.tasks) ? pkg.tasks : [];

    const steps =
        Array.isArray(pkg.plan?.steps)
            ? pkg.plan.steps
            : [];

    return (
        activeStatuses.has(status) &&
        tasks.length === 0 &&
        steps.length === 0
    );
});

console.log(JSON.stringify(
    invalid.map(pkg => ({
        id: pkg.id,
        status: pkg.status,
        objective: pkg.objective,
        createdAt: pkg.createdAt,
        tasks: pkg.tasks?.length || 0,
        steps: pkg.plan?.steps?.length || 0
    })),
    null,
    2
));
