"use strict";

const WorkerContract = require("./WorkerContract");

class BusinessWorker extends WorkerContract {

    constructor(name, asset) {
        super(name);

        this.asset = asset;
        this.session = null;
        this.connected = false;
    }

    connect() {
        this.connected = true;

        return {
            ok: true,
            worker: this.name,
            asset: this.asset,
            connected: true
        };
    }

    disconnect() {
        this.connected = false;
        this.session = null;

        return {
            ok: true,
            worker: this.name,
            asset: this.asset
        };
    }

    getStatus() {
        return {
            worker: this.name,
            asset: this.asset,
            connected: this.connected,
            initialized: this.status === "initialized"
        };
    }

    execute(mission) {

        if (!this.connected) {

            return {
                ok: false,
                reason: "Worker not connected",
                worker: this.name
            };

        }

        return {
            ok: true,
            worker: this.name,
            mission
        };
    }

}

module.exports = BusinessWorker;