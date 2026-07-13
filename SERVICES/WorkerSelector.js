"use strict";

const CapabilityRegistry = require("./CapabilityRegistry");
const WorkerRegistry = require("./WorkerRegistry");

class WorkerSelector {
    selectByCapability(capability) {
        const candidates = CapabilityRegistry.findByCapability(capability);

        if (!candidates || candidates.length === 0) {
            return {
                ok: false,
                reason: "No capable worker found",
                capability,
                candidate: null,
                worker: null
            };
        }

        const healthy =
            candidates.find(c => c.status === "healthy") || candidates[0];

        const worker =
            WorkerRegistry.get(healthy.service) || null;

        return {
            ok: !!worker,
            capability,
            selected: healthy.service,
            candidate: healthy,
            worker,
            reason: worker
                ? "Worker selected"
                : "Worker capability exists, but live worker is not registered"
        };
    }
}

module.exports = new WorkerSelector();