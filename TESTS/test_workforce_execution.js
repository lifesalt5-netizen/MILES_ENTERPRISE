const workflow = require("../SERVICES/WorkflowService");
const execution = require("../SERVICES/ExecutionService");
const taskQueue = require("../CORE/TaskQueue");

async function main() {
  const wf = workflow.createWorkflow("Grow sales pipeline with email marketing and capture strategy");
  console.log("WORKFLOW_CREATED", wf.ok, wf.workPackage.id, wf.queuedTasks.length);

  const before = taskQueue.list("QUEUED").length;
  console.log("QUEUED_BEFORE", before);

  const result = await execution.runNext();
  console.log("RUN_NEXT", JSON.stringify(result, null, 2));

  const after = taskQueue.list("QUEUED").length;
  console.log("QUEUED_AFTER", after);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
