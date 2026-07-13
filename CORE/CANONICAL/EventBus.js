"use strict";

const EventEmitter = require("events");
const logger = require("./Logger");

class CanonicalEventBus extends EventEmitter {
  publish(type, payload = {}) {
    const event = {
      type,
      payload,
      ts: new Date().toISOString()
    };

    logger.info(`EVENT:${type}`, payload);

    this.emit(type, event);
    this.emit("*", event);

    return event;
  }

  subscribe(type, handler) {
    this.on(type, handler);
  }

  subscribeAll(handler) {
    this.on("*", handler);
  }
}

module.exports = new CanonicalEventBus();
