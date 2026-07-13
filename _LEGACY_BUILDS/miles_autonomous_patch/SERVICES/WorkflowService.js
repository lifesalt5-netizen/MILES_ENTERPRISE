"use strict";

const workPackages = require("./WorkPackageService");
const taskManager = require("./TaskManager");

function normalizePriority(value) {
  if (typeof value === "number") return value;

  const text = String(value || "").toUpperCase();

  if (text === "CRITICAL") return 100;
  if (text === "HIGH") return 85;
  if (text === "MEDIUM") return 60;
  if (text === "LOW") return 35;

  return 50;
}

class WorkflowService {
  createWorkflow(objective, context = {}) {
    const wp = workPackages.create(objective, context);

    if (wp.status === "AWAITING_APPROVAL") {
      return {
        ok: true,
        status: "AWAITING_APPROVAL",
        workPackage: wp,
        message: "Work package created and awaiting CEO approval."
      };
    }

    const queuedTasks = [];
    const priority = normalizePriority(wp.priorityScore || wp.priority || context.priority);

    for (const step of wp.tasks || []) {
      const task = taskManager.create(
        step.taskType || "WORKFORCE_STEP",
        {
          workPackageId: wp.id,
          objective: wp.objective,
          capability: step.capability,
          assignedTo: step.assignedTo,
          department: step.department,
          provider: step.provider || null,
          action: step.action || `Execute workforce step: ${step.capability}`,
          expectedOutput: step.expectedOutput,
          verification: step.verification,
          system: step.system || "MILES",
          sourceWorkflow: {
            objective: wp.objective,
            domain: wp.plan?.domain || null,
            workforce: wp.plan?.workforce || null,
            executionAuthority: wp.plan?.executionAuthority || null,
            context: wp.plan?.context || context || {}
          }
        },
        priority
      );

      queuedTasks.push(task);
    }

    return {
      ok: true,
      status: "QUEUED",
      workPackage: wp,
      queuedTasks
    };
  }

  status() {
    const packages = workPackages.list();

    return {
      ok: true,
      total: packages.length,
      queued: packages.filter(p => p.status === "QUEUED").length,
      awaitingApproval: packages.filter(p => p.status === "AWAITING_APPROVAL").length,
      completed: packages.filter(p => p.status === "COMPLETED").length,
      active: packages.slice(0, 10)
    };
  }
}

module.exports = new WorkflowService();
