const fs = require("fs");
const path = require("path");
const logger = require("./Logger");
const eventBus = require("./EventBus");

class TaskQueue {
  constructor() {
    this.queuePath = path.join(process.cwd(), "DATA", "runtime", "task_queue.json");
    const dir = path.dirname(this.queuePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.queuePath)) fs.writeFileSync(this.queuePath, JSON.stringify([], null, 2));
  }

  _read() {
    return JSON.parse(fs.readFileSync(this.queuePath, "utf8"));
  }

  _write(tasks) {
    fs.writeFileSync(this.queuePath, JSON.stringify(tasks, null, 2));
  }

  add(type, payload = {}, priority = 50) {
    const tasks = this._read();
    const task = {
      id: `TASK-${Date.now()}`,
      type,
      payload,
      priority,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tasks.push(task);
    tasks.sort((a, b) => b.priority - a.priority);
    this._write(tasks);
    logger.info(`Task queued: ${task.id}`, task);
    eventBus.publish("TASK_QUEUED", task);
    return task;
  }

  list(status = null) {
    const tasks = this._read();
    return status ? tasks.filter(t => t.status === status) : tasks;
  }

  update(id, patch) {
    const tasks = this._read();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) throw new Error(`Task not found: ${id}`);
    tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    this._write(tasks);
    eventBus.publish("TASK_UPDATED", tasks[idx]);
    return tasks[idx];
  }
}

module.exports = new TaskQueue();
