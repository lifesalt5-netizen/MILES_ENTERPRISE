"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const EVENT_DIR = path.join(ROOT, "DATA", "events");
const EVENT_LOG = path.join(EVENT_DIR, "event_log.jsonl");

function ensureDirs() {
  fs.mkdirSync(EVENT_DIR, { recursive: true });
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

class EventBus {
  constructor() {
    this.subscribers = {};
    ensureDirs();
  }

  publish(eventType, payload = {}, metadata = {}) {
    if (!eventType || typeof eventType !== "string") {
      throw new Error("EventBus.publish requires an eventType string.");
    }

    ensureDirs();

    const event = {
      id: this.createEventId(),
      type: eventType,
      payload: safeJson(payload),
      metadata: {
        source: metadata.source || "MILES",
        correlationId: metadata.correlationId || null,
        workPackageId: metadata.workPackageId || payload.workPackageId || null,
        taskId: metadata.taskId || payload.taskId || null,
        ...metadata
      },
      createdAt: new Date().toISOString()
    };

    fs.appendFileSync(EVENT_LOG, JSON.stringify(event) + "\n");

    const handlers = this.subscribers[eventType] || [];
    const wildcardHandlers = this.subscribers["*"] || [];

    for (const handler of [...handlers, ...wildcardHandlers]) {
      try {
        handler(event);
      } catch (err) {
        fs.appendFileSync(
          EVENT_LOG,
          JSON.stringify({
            id: this.createEventId(),
            type: "event.handler.failed",
            payload: {
              originalEventId: event.id,
              originalType: event.type,
              error: err.message
            },
            metadata: {
              source: "EventBus"
            },
            createdAt: new Date().toISOString()
          }) + "\n"
        );
      }
    }

    return event;
  }

  subscribe(eventType, handler) {
    if (!eventType || typeof eventType !== "string") {
      throw new Error("EventBus.subscribe requires an eventType string.");
    }

    if (typeof handler !== "function") {
      throw new Error("EventBus.subscribe requires a handler function.");
    }

    if (!this.subscribers[eventType]) {
      this.subscribers[eventType] = [];
    }

    this.subscribers[eventType].push(handler);

    return {
      ok: true,
      eventType,
      subscribers: this.subscribers[eventType].length
    };
  }

  recent(limit = 50) {
    ensureDirs();

    if (!fs.existsSync(EVENT_LOG)) {
      return [];
    }

    const lines = fs.readFileSync(EVENT_LOG, "utf8")
      .split(/\r?\n/)
      .filter(Boolean);

    return lines
      .slice(-limit)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  status() {
    return {
      ok: true,
      eventLog: EVENT_LOG,
      subscriberTypes: Object.keys(this.subscribers),
      recentEvents: this.recent(10).length
    };
  }

  createEventId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const rand = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
    return `EVT-${stamp}-${rand}`;
  }
}

module.exports = new EventBus();