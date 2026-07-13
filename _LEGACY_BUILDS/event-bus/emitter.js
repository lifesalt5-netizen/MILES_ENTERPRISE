"use strict";

const EventEmitter = require("events");

class Bus extends EventEmitter {}

const bus = new Bus();

// SAFE GLOBAL EMITTER (USE THIS EVERYWHERE)
function emitEvent(event, payload) {
  bus.emit(event, payload);
}

module.exports = {
  bus,
  emitEvent
};