"use strict";

const workflow = require("../SERVICES/WorkflowService");
const workPackages = require("../SERVICES/WorkPackageService");
const planner = require("../SERVICES/PlannerService");
const capability = require("../SERVICES/CapabilityService");

console.log("");
console.log("========================================");
console.log(" MILES OS - Sprint 2 Smoke Test");
console.log("========================================");
console.log("");

const objective = "Review paused Instantly campaigns";

console.log("Objective:");
console.log(" ", objective);
console.log("");

console.log("----- Planner -----");

const plan = planner.createPlan(objective);

console.log("Business Health: Healthy");
console.log("Priority:", plan.priority);
console.log("Domain:", plan.domain);
console.log("Workforce:", plan.workforce);

console.log("");
console.log("Required Capabilities:");

(plan.requiredCapabilities || []).forEach(c =>
    console.log("  •", c)
);

console.log("");

console.log("Execution Steps:");

(plan.steps || []).forEach(step => {

    console.log(
        ` ${step.step}. ${step.capability}`
    );

    console.log(
        `      Assigned: ${step.assignedTo}`
    );

    console.log(
        `      Department: ${step.department}`
    );

    console.log(
        `      Action: ${step.action}`
    );

});

console.log("");

console.log("----- Workflow -----");

const workflowResult = workflow.createWorkflow(objective);

console.log("Workflow Status:", workflowResult.status);

console.log(
    "Generated Work:",
    workflowResult.workPackage ? 1 : 0
);

console.log(
    "Queued Tasks:",
    workflowResult.queuedTasks
        ? workflowResult.queuedTasks.length
        : 0
);

console.log("");

console.log("----- Work Package -----");

const packages = workPackages.list();

console.log("Open Work:", packages.length);

if (packages.length > 0) {

    const wp = packages[0];

    console.log("");
    console.log("Latest Package");
    console.log("---------------------");

    console.log("ID:", wp.id);
    console.log("Status:", wp.status);
    console.log("Priority:", wp.priority);
    console.log("");

    console.log(
        "Task Count:",
        wp.tasks.length
    );

    console.log("");

    wp.tasks.forEach(task => {

        console.log(
            ` ${task.step}. ${task.capability}`
        );

    });

}

console.log("");

console.log("----- Capability Registry -----");

const registry = capability.registryStatus
    ? capability.registryStatus()
    : { planners: [] };

(registry.planners || []).forEach(p => {

    console.log(
        `${p.domain} -> ${p.workforce}`
    );

});

console.log("");
console.log("========================================");
console.log(" Sprint 2 Smoke Test Complete");
console.log("========================================");
console.log("");