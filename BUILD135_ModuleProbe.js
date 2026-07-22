"use strict";

function inspectModule(label, modulePath) {
  try {
    const value = require(modulePath);

    const output = {
      label,
      modulePath,
      type: typeof value,
      keys:
        value && typeof value === "object"
          ? Object.keys(value).sort()
          : [],
      prototypeMethods:
        value &&
        typeof value === "object"
          ? Object.getOwnPropertyNames(
              Object.getPrototypeOf(value)
            ).filter(name => name !== "constructor").sort()
          : []
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      label,
      modulePath,
      error:
        error.stack ||
        error.message
    }, null, 2));
  }
}

inspectModule(
  "TaskManager",
  "./SERVICES/TaskManager"
);

inspectModule(
  "TaskQueue",
  "./CORE/TaskQueue"
);

inspectModule(
  "WorkflowService",
  "./SERVICES/WorkflowService"
);

inspectModule(
  "WorkPackageService",
  "./SERVICES/WorkPackageService"
);
