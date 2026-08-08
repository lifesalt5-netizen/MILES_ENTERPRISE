"use strict";

const executiveDispatcher = require("../ExecutiveDispatcher");

module.exports = {
execute(task = {}) {
const payload = task.payload || {};
const mission = executiveDispatcher.acceptMission({
title: task.title || "MILES Self Development",
objective:
payload.objective ||
payload.command ||
task.objective ||
task.title ||
"Improve MILES autonomy",
priority: task.priority || 1,
authority: task.authority || "AUTOMATIC_ENGINEERING"
});

return {
  worker: "SELF_DEVELOPMENT",
  completed: true,
  taskId: task.id || null,
  missionId: mission.id,
  queuedTasks: mission.tasks.length,
  mission
};
}
};
