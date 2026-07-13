"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const QUEUE_DIR = path.join(ROOT, "DATA", "queue");

const FILES = {
  pending: path.join(QUEUE_DIR, "pending.json"),
  active: path.join(QUEUE_DIR, "active.json"),
  completed: path.join(QUEUE_DIR, "completed.json"),
  failed: path.join(QUEUE_DIR, "failed.json")
};

function now() {
  return new Date().toISOString();
}

function ensure() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });

  for (const file of Object.values(FILES)) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "[]");
    }
  }
}

function read(file) {
  ensure();

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function write(file, data) {
  ensure();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function id(prefix = "CMD") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class CommandQueue {
  constructor() {
    ensure();
  }

  add(command = {}) {
    const pending = read(FILES.pending);

    const item = {
      id: command.id || id("CMD"),
      title: command.title || "Untitled Command",
      type: command.type || "GENERAL",
      priority: command.priority || 3,
      status: "PENDING",
      authority: command.authority || "AUTOMATIC",
      createdAt: now(),
      updatedAt: now(),
      payload: command.payload || {},
      history: [
        {
          at: now(),
          event: "CREATED"
        }
      ]
    };

    pending.push(item);
    pending.sort((a, b) => Number(a.priority) - Number(b.priority));

    write(FILES.pending, pending);

    return item;
  }

  claim(worker = "UNKNOWN") {
    const pending = read(FILES.pending);
    const active = read(FILES.active);

    if (!pending.length) return null;

    const item = pending.shift();

    item.status = "ACTIVE";
    item.worker = worker;
    item.updatedAt = now();
    item.history.push({
      at: now(),
      event: "CLAIMED",
      worker
    });

    active.push(item);

    write(FILES.pending, pending);
    write(FILES.active, active);

    return item;
  }

  complete(id, result = {}) {
    const active = read(FILES.active);
    const completed = read(FILES.completed);

    const idx = active.findIndex(x => x.id === id);

    if (idx === -1) return false;

    const item = active.splice(idx, 1)[0];

    item.status = "COMPLETED";
    item.result = result;
    item.completedAt = now();
    item.updatedAt = now();
    item.history.push({
      at: now(),
      event: "COMPLETED"
    });

    completed.push(item);

    write(FILES.active, active);
    write(FILES.completed, completed);

    return true;
  }

  fail(id, error = {}) {
    const active = read(FILES.active);
    const failed = read(FILES.failed);

    const idx = active.findIndex(x => x.id === id);

    if (idx === -1) return false;

    const item = active.splice(idx, 1)[0];

    item.status = "FAILED";
    item.error = {
      message: error.message || String(error),
      stack: error.stack || null
    };
    item.failedAt = now();
    item.updatedAt = now();
    item.history.push({
      at: now(),
      event: "FAILED",
      message: item.error.message
    });

    failed.push(item);

    write(FILES.active, active);
    write(FILES.failed, failed);

    return true;
  }

  list() {
    return {
      pending: read(FILES.pending),
      active: read(FILES.active),
      completed: read(FILES.completed),
      failed: read(FILES.failed)
    };
  }

  status() {
    const all = this.list();

    return {
      pending: all.pending.length,
      active: all.active.length,
      completed: all.completed.length,
      failed: all.failed.length
    };
  }
}

module.exports = new CommandQueue();