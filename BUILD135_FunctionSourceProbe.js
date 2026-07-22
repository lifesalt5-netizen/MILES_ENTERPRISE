"use strict";

function show(label, value, method) {
  console.log("");
  console.log("============================================================");
  console.log(`${label}.${method}`);
  console.log("============================================================");

  if (!value) {
    console.log("MODULE UNAVAILABLE");
    return;
  }

  const fn = value[method];

  if (typeof fn !== "function") {
    console.log("METHOD NOT FOUND");
    return;
  }

  console.log(fn.toString());
}

const taskManager =
  require("./SERVICES/TaskManager");

const taskQueue =
  require("./CORE/TaskQueue");

const workflowService =
  require("./SERVICES/WorkflowService");

show(
  "TaskManager",
  taskManager,
  "create"
);

show(
  "TaskManager",
  taskManager,
  "createTask"
);

show(
  "TaskQueue",
  taskQueue,
  "add"
);

show(
  "TaskQueue",
  taskQueue,
  "enqueue"
);

show(
  "WorkflowService",
  workflowService,
  "createWorkflow"
);
