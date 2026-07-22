const EventEmitter = require("events");
const path = require("path");
const logger = require("../Logger");


class MilesEventBus extends EventEmitter {

    publish(eventType, payload = {}) {

        const event = {
            type: eventType,
            payload,
            timestamp: new Date().toISOString()
        };

        logger.info(`EVENT ${eventType}`, payload);

        this.emit(eventType, event);
        this.emit("*", event);

        return event;
    }

    subscribe(eventType, handler) {
        this.on(eventType, handler);
    }

    emitEvent(eventType, payload = {}) {
        return this.publish(eventType, payload);
    }

    onAny(handler) {
        this.on("*", handler);
    }
}

module.exports = new MilesEventBus();

