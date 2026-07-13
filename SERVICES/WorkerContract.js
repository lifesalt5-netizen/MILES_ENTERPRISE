"use strict";

class WorkerContract {
    constructor(name) {
        this.name = name || this.constructor.name;
        this.status = "created";
    }

    initialize() {
        this.status = "initialized";
        return { ok: true, worker: this.name, status: this.status };
    }

    healthCheck() {
        return { ok: true, worker: this.name, status: this.status };
    }

    execute(mission) {
        return {
            ok: false,
            worker: this.name,
            mission,
            reason: "execute() not implemented"
        };
    }

    validate(result) {
        return {
            ok: !!result?.ok,
            worker: this.name,
            result
        };
    }

    recover(error) {
        return {
            ok: false,
            worker: this.name,
            error: error?.message || String(error),
            reason: "recover() not implemented"
        };
    }

    shutdown() {
        this.status = "shutdown";
        return { ok: true, worker: this.name, status: this.status };
    }
}

module.exports = WorkerContract;