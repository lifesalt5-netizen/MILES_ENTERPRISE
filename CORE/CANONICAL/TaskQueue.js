"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("./Logger");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();
const QUEUE_FILE = path.join(ROOT, "DATA", "canonical_runtime", "task_queue.json");

function ensure() {
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ items: [] }, null, 2), "utf8");
  }
}

function read() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return { items: [] };
  }
}

function write(data) {
  ensure();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), "utf8");
}

class CanonicalTaskQueue {
  add(task) {
    const db = read();

    const item = {
      id: task.id || `TASK-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
      status: task.status || "READY",
      priority: task.priority || 3,
      department: task.department || "General",
      title: task.title || "Untitled task",
      payload: task.payload || {},
      requiresKevin: Boolean(task.requiresKevin),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.items.push(item);
    write(db);

    logger.info("TASK_ADDED", item);

    return item;
  }

  list() {
    return read().items || [];
  }

  ready() {
    return this.list().filter(t => t.status === "READY");
  }

  summary() {
    const items = this.list();
    return {
      total: items.length,
      ready: items.filter(t => t.status === "READY").length,
      awaitingApproval: items.filter(t => t.requiresKevin).length,
      completed: items.filter(t => t.status === "COMPLETED").length,
      failed: items.filter(t => t.status === "FAILED").length
    };
  }
}

module.exports = new CanonicalTaskQueue();
