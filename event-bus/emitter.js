"use strict";

/*
 * Legacy compatibility shim
 *
 * Older MILES components expect:
 *
 *   const { bus } = require("../event-bus/emitter");
 *   const { emitEvent } = require("../event-bus/emitter");
 *
 * The active runtime now uses CORE/EventBus.js.
 * This adapter preserves the legacy API while routing
 * all events through the current EventBus implementation.
 */

const bus = require("../CORE/EventBus");

function emitEvent(eventType, payload = {}) {
    return bus.publish(eventType, payload);
}

module.exports = {
    bus,
    emitEvent
};