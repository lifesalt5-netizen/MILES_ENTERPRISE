const taskQueue = require("../CORE/TaskQueue");
const { requiresApproval } = require("../CORE/authority");

class TaskManager {
  create(type, payload = {}, priority = 50) {
    return taskQueue.add(type, payload, priority);
  }

  list(status = null) {
    return taskQueue.list(status);
  }

  next() {
    return taskQueue.list("QUEUED")[0] || null;
  }

  complete(id, result = {}) {
    return taskQueue.update(id, { status: "COMPLETED", result });
  }

  fail(id, error) {
    return taskQueue.update(id, { status: "FAILED", error: String(error) });
  }

  approvalCheck(system, action) {
    return requiresApproval(system, action);
  }
}

module.exports = new TaskManager();
