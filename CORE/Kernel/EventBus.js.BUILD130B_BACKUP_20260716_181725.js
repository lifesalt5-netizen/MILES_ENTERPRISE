const EventEmitter = require("events");
const path = require("path");
const { Logger } = require("../Logger");

const ROOT =
    process.env.MILES_ROOT ||
    path.resolve(__dirname, "..");

const logger = new Logger(ROOT);

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
