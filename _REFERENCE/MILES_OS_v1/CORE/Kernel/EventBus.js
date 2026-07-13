const EventEmitter = require("events");

class EventBus extends EventEmitter {
    emitEvent(eventName, payload = {}) {
        const event = {
            name: eventName,
            payload,
            timestamp: new Date().toISOString()
        };

        this.emit(eventName, event);
        this.emit("*", event);

        return event;
    }

    onAny(handler) {
        this.on("*", handler);
    }
}

module.exports = new EventBus();